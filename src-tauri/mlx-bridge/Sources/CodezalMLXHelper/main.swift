import CodezalMLXBridge
import Darwin
import Foundation

private let eventOutput = FileHandle(
    fileDescriptor: dup(STDOUT_FILENO),
    closeOnDealloc: true
)

private let eventOutputLock = NSLock()
private let requestStateLock = NSLock()
nonisolated(unsafe) private var activeRequestId: String?
nonisolated(unsafe) private var activeRequestTerminal = false

private struct ServeRequest: Decodable {
    let id: String
    let command: String
    let input: String
}

private struct ErrorEvent: Encodable {
    let kind = "error"
    let message: String
}

private struct DoneEvent: Encodable {
    let kind = "done"
}

private func writeLine(_ text: String) {
    eventOutputLock.lock()
    defer { eventOutputLock.unlock() }
    eventOutput.write(Data(text.utf8))
    eventOutput.write(Data("\n".utf8))
}

private func encodeJSON<T: Encodable>(_ value: T) -> String {
    let data = (try? JSONEncoder().encode(value)) ?? Data("null".utf8)
    return String(data: data, encoding: .utf8) ?? "null"
}

private func isTerminalEvent(_ event: String) -> Bool {
    guard
        let data = event.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let kind = object["kind"] as? String
    else {
        return false
    }
    return kind == "done" || kind == "error"
}

private func beginRequest(_ id: String) {
    requestStateLock.lock()
    activeRequestId = id
    activeRequestTerminal = false
    requestStateLock.unlock()
}

private func endRequest() {
    requestStateLock.lock()
    activeRequestId = nil
    activeRequestTerminal = false
    requestStateLock.unlock()
}

private func requestDidEmitTerminal() -> Bool {
    requestStateLock.lock()
    defer { requestStateLock.unlock() }
    return activeRequestTerminal
}

private func writeEvent(_ event: String) {
    let terminal = isTerminalEvent(event)
    requestStateLock.lock()
    let requestId = activeRequestId
    if terminal {
        activeRequestTerminal = true
    }
    requestStateLock.unlock()

    if let requestId {
        writeLine(#"{"id":\#(encodeJSON(requestId)),"event":\#(event)}"#)
    } else {
        writeLine(event)
    }
}

private func writeError(_ message: String) {
    writeEvent(encodeJSON(ErrorEvent(message: message)))
}

private func redirectStdoutToStderr() {
    fflush(stdout)
    _ = dup2(STDERR_FILENO, STDOUT_FILENO)
}

private func startParentWatcher() {
    let envPid = ProcessInfo.processInfo.environment["CODEZAL_MLX_PARENT_PID"]
        .flatMap { Int32($0) }
    let parentPid = envPid ?? getppid()
    guard parentPid > 1 else { return }

    Thread {
        while true {
            sleep(1)
            if getppid() == 1 || kill(parentPid, 0) != 0 {
                exit(130)
            }
        }
    }.start()
}

nonisolated(unsafe) private let callback: CodezalMLXCallback = { event, _ in
    guard let event else { return }
    writeEvent(String(cString: event))
}

nonisolated(unsafe) private let shouldCancel: CodezalMLXCancel = { _ in
    0
}

private func readStdin() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

private final class ExitStatus: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    private var code: Int32 = 0

    func finish(_ next: Int32) {
        lock.lock()
        code = next
        done = true
        lock.unlock()
    }

    func snapshot() -> (done: Bool, code: Int32) {
        lock.lock()
        defer { lock.unlock() }
        return (done, code)
    }
}

private func runBridge(command: String?, input: String) -> Int32 {
    switch command {
    case "chat":
        return input.withCString { ptr in
            codezal_mlx_chat(ptr, callback, nil, shouldCancel, nil)
        }
    case "download":
        return input.withCString { ptr in
            codezal_mlx_download(ptr, callback, nil, shouldCancel, nil)
        }
    default:
        writeError("missing MLX helper command")
        return 2
    }
}

private func runBridgeAndWait(command: String?, input: String) -> Int32 {
    let status = ExitStatus()
    Thread {
        status.finish(runBridge(command: command, input: input))
    }.start()

    while true {
        let current = status.snapshot()
        if current.done {
            return current.code
        }
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
    }
}

private func serveLoop() {
    while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            continue
        }

        let request: ServeRequest
        do {
            request = try JSONDecoder().decode(ServeRequest.self, from: Data(line.utf8))
        } catch {
            writeError("invalid MLX helper request")
            continue
        }

        beginRequest(request.id)
        let code = runBridgeAndWait(command: request.command, input: request.input)
        if !requestDidEmitTerminal() {
            if code == 0 {
                writeEvent(encodeJSON(DoneEvent()))
            } else {
                writeError("MLX helper command failed with exit code \(code)")
            }
        }
        endRequest()
    }
}

private let command = CommandLine.arguments.dropFirst().first

redirectStdoutToStderr()
startParentWatcher()

if command == "serve" {
    serveLoop()
    exit(0)
}

let input = readStdin()
exit(runBridgeAndWait(command: command, input: input))
