import Foundation
import HuggingFace
import MLXHuggingFace
import MLXLLM
import MLXLMCommon
import Tokenizers

public typealias CodezalMLXCallback = @convention(c) (
    UnsafePointer<CChar>?, UnsafeMutableRawPointer?
) -> Void

public typealias CodezalMLXCancel = @convention(c) (UnsafeMutableRawPointer?) -> Int32

private struct ChatRequest: Swift.Decodable, Sendable {
    let model: String?
    let messages: [OpenAIMessage]
    let tools: [OpenAITool]?
    let maxTokens: Int?
    let temperature: Double?
    let topP: Double?

    enum CodingKeys: String, Swift.CodingKey {
        case model
        case messages
        case tools
        case maxTokens = "max_tokens"
        case temperature
        case topP = "top_p"
    }

    enum AlternateCodingKeys: String, Swift.CodingKey {
        case maxCompletionTokens = "max_completion_tokens"
    }

    init(from decoder: any Swift.Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let alt = try decoder.container(keyedBy: AlternateCodingKeys.self)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        messages = try c.decodeIfPresent([OpenAIMessage].self, forKey: .messages) ?? []
        tools = try c.decodeIfPresent([OpenAITool].self, forKey: .tools)
        maxTokens = try c.decodeIfPresent(Int.self, forKey: .maxTokens)
            ?? alt.decodeIfPresent(Int.self, forKey: .maxCompletionTokens)
        temperature = try c.decodeIfPresent(Double.self, forKey: .temperature)
        topP = try c.decodeIfPresent(Double.self, forKey: .topP)
    }

    var toolSpecs: [ToolSpec]? {
        let specs = tools?.compactMap(\.toolSpec) ?? []
        return specs.isEmpty ? nil : specs
    }
}

private struct OpenAIMessage: Swift.Decodable, Sendable {
    let role: String
    let content: OpenAIContent?
    let toolCalls: [OpenAIToolCall]?
    let toolCallId: String?

    enum CodingKeys: String, Swift.CodingKey {
        case role
        case content
        case toolCalls = "tool_calls"
        case toolCallId = "tool_call_id"
    }

    func chatMessage() -> Chat.Message? {
        let text = content?.text ?? ""
        switch role {
        case "assistant":
            return .assistant(text, toolCalls: toolCalls?.map(\.toolCall))
        case "tool":
            return .tool(text, id: toolCallId)
        default:
            guard let role = Chat.Message.Role(rawValue: role) else { return nil }
            return Chat.Message(role: role, content: text)
        }
    }

    var signature: String {
        let text = content?.text ?? ""
        let calls = toolCalls?.map(\.signature).joined(separator: ",") ?? ""
        return "\(role):\(toolCallId ?? ""):\(text):\(calls)"
    }
}

private enum OpenAIContent: Swift.Decodable, Sendable {
    case text(String)
    case parts([OpenAIContentPart])

    init(from decoder: any Swift.Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let text = try? c.decode(String.self) {
            self = .text(text)
            return
        }
        self = .parts((try? c.decode([OpenAIContentPart].self)) ?? [])
    }

    var text: String {
        switch self {
        case .text(let text):
            text
        case .parts(let parts):
            parts.compactMap(\.text).joined(separator: "\n")
        }
    }
}

private struct OpenAIContentPart: Swift.Decodable, Sendable {
    let type: String?
    let text: String?
}

private struct OpenAITool: Swift.Decodable, Sendable {
    let value: JSONValue

    init(from decoder: any Swift.Decoder) throws {
        value = try JSONValue(from: decoder)
    }

    var toolSpec: ToolSpec? {
        guard case .object(let object) = value else { return nil }
        return sendableObject(object)
    }
}

private struct OpenAIToolCall: Swift.Decodable, Sendable {
    struct Function: Swift.Decodable, Sendable {
        let name: String
        let arguments: OpenAIToolArguments?
    }

    let id: String?
    let function: Function

    var toolCall: ToolCall {
        ToolCall(
            function: .init(name: function.name, arguments: function.arguments?.object ?? [:]),
            id: id
        )
    }

    var signature: String {
        "\(id ?? ""):\(function.name):\(encodeJSONString(function.arguments?.object ?? [:]))"
    }
}

private enum OpenAIToolArguments: Swift.Decodable, Sendable {
    case object([String: JSONValue])

    var object: [String: JSONValue] {
        switch self {
        case .object(let object):
            object
        }
    }

    init(from decoder: any Swift.Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let text = try? c.decode(String.self) {
            guard let data = text.data(using: .utf8), !text.isEmpty else {
                self = .object([:])
                return
            }
            self = .object((try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:])
            return
        }
        self = .object((try? c.decode([String: JSONValue].self)) ?? [:])
    }
}

private func sendableValue(_ value: JSONValue) -> any Sendable {
    switch value {
    case .null:
        ""
    case .bool(let value):
        value
    case .int(let value):
        value
    case .double(let value):
        value
    case .string(let value):
        value
    case .array(let values):
        values.map { sendableValue($0) }
    case .object(let object):
        sendableObject(object)
    }
}

private func sendableObject(_ object: [String: JSONValue]) -> [String: any Sendable] {
    object.mapValues { sendableValue($0) }
}

private func encodeJSONString<T: Encodable>(_ value: T) -> String {
    let data = (try? JSONEncoder().encode(value)) ?? Data("null".utf8)
    return String(decoding: data, as: UTF8.self)
}

private struct ChatEntry {
    let message: Chat.Message
    let signature: String
}

private func hasPrefix(_ values: [String], prefix: [String]) -> Bool {
    guard prefix.count <= values.count else { return false }
    for index in prefix.indices {
        if values[index] != prefix[index] {
            return false
        }
    }
    return true
}

private func ensureToolCallId(_ toolCall: ToolCall, index: Int) -> ToolCall {
    if toolCall.id != nil {
        return toolCall
    }
    return ToolCall(function: toolCall.function, id: "call_\(index)")
}

private func assistantSignature(text: String, toolCalls: [ToolCall]) -> String {
    let calls = toolCalls
        .map { "\($0.id ?? ""):\($0.function.name):\(encodeJSONString($0.function.arguments))" }
        .joined(separator: ",")
    return "assistant::\(text):\(calls)"
}

private struct BridgeEvent: Encodable {
    let kind: String
    let json: String?
    let message: String?
    let finishReason: String?
    let model: String?
    let downloaded: Int64?
    let total: Int64?
    let tokensPerSec: Double?
    let tokens: Int?
    let ttftMs: Int?

    enum CodingKeys: String, CodingKey {
        case kind
        case json
        case message
        case finishReason = "finish_reason"
        case model
        case downloaded
        case total
        case tokensPerSec = "tokens_per_sec"
        case tokens
        case ttftMs = "ttft_ms"
    }

    static func delta(_ text: String) -> Self {
        let payload = #"{"content":\#(Self.jsonString(text))}"#
        return Self(kind: "oai_delta", json: payload, message: nil, finishReason: nil, model: nil, downloaded: nil, total: nil, tokensPerSec: nil, tokens: nil, ttftMs: nil)
    }

    static func toolCall(_ toolCall: ToolCall, index: Int) -> Self {
        let id = toolCall.id ?? "call_\(index)"
        let arguments = encodeJSONString(toolCall.function.arguments)
        let payload = #"{"tool_calls":[{"index":\#(index),"id":\#(Self.jsonString(id)),"type":"function","function":{"name":\#(Self.jsonString(toolCall.function.name)),"arguments":\#(Self.jsonString(arguments))}}]}"#
        return Self(kind: "oai_delta", json: payload, message: nil, finishReason: nil, model: nil, downloaded: nil, total: nil, tokensPerSec: nil, tokens: nil, ttftMs: nil)
    }

    static func done(model: String, info: GenerateCompletionInfo? = nil, finishReason: String? = nil) -> Self {
        Self(
            kind: "done",
            json: nil,
            message: nil,
            finishReason: finishReason ?? Self.finishReason(info?.stopReason),
            model: model,
            downloaded: nil,
            total: nil,
            tokensPerSec: info?.tokensPerSecond,
            tokens: info?.generationTokenCount,
            ttftMs: info.map { Int(($0.promptTime * 1000).rounded()) }
        )
    }

    static func error(_ message: String) -> Self {
        Self(kind: "error", json: nil, message: message, finishReason: nil, model: nil, downloaded: nil, total: nil, tokensPerSec: nil, tokens: nil, ttftMs: nil)
    }

    static func notice(_ message: String, model: String) -> Self {
        Self(kind: "notice", json: nil, message: message, finishReason: nil, model: model, downloaded: nil, total: nil, tokensPerSec: nil, tokens: nil, ttftMs: nil)
    }

    static func progress(downloaded: Int64, total: Int64) -> Self {
        Self(kind: "progress", json: nil, message: nil, finishReason: nil, model: nil, downloaded: downloaded, total: total, tokensPerSec: nil, tokens: nil, ttftMs: nil)
    }

    private static func jsonString(_ text: String) -> String {
        let data = (try? JSONEncoder().encode(text)) ?? Data(#""""#.utf8)
        return String(decoding: data, as: UTF8.self)
    }

    private static func finishReason(_ reason: GenerateStopReason?) -> String {
        switch reason {
        case .length:
            "length"
        case .cancelled:
            "stop"
        case .stop, nil:
            "stop"
        }
    }
}

private struct CallbackSink: @unchecked Sendable {
    let callback: CodezalMLXCallback?
    let userData: UnsafeMutableRawPointer?
    let shouldCancel: CodezalMLXCancel?
    let cancelData: UnsafeMutableRawPointer?

    func emit(_ event: BridgeEvent) {
        guard let callback else { return }
        guard let data = try? JSONEncoder().encode(event) else { return }
        let json = String(decoding: data, as: UTF8.self)
        json.withCString { ptr in
            callback(ptr, userData)
        }
    }

    var isCancelled: Bool {
        shouldCancel?(cancelData) != 0
    }
}

private final class StatusBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Int32 = 0

    func set(_ next: Int32) {
        lock.lock()
        value = next
        lock.unlock()
    }

    func get() -> Int32 {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

private actor CodezalMLXRuntime {
    private struct SessionState {
        var session: ChatSession
        var transcript: [String]
        var toolsSignature: String
    }

    private var containers: [String: ModelContainer] = [:]
    private var sessions: [String: SessionState] = [:]

    func run(_ request: ChatRequest, sink: CallbackSink) async throws {
        let modelId = normalizeModelId(request.model)
        if sink.isCancelled {
            sink.emit(.done(model: modelId))
            return
        }
        let container = try await container(for: modelId, sink: sink)
        if sink.isCancelled {
            sink.emit(.done(model: modelId))
            return
        }
        let parameters = GenerateParameters(
            maxTokens: request.maxTokens,
            temperature: Float(request.temperature ?? 0.6),
            topP: Float(request.topP ?? 1.0)
        )
        let entries = request.messages.compactMap { message -> ChatEntry? in
            guard let chatMessage = message.chatMessage() else { return nil }
            return ChatEntry(message: chatMessage, signature: message.signature)
        }
        guard !entries.isEmpty else {
            throw BridgeError.emptyMessages
        }
        let tools = request.toolSpecs
        let toolsSignature = request.tools.map { encodeJSONString($0.map(\.value)) } ?? ""
        let state = try await sessionState(
            modelId: modelId,
            container: container,
            parameters: parameters,
            tools: tools,
            toolsSignature: toolsSignature,
            requestedTranscript: entries.map(\.signature)
        )
        state.session.generateParameters = parameters
        state.session.tools = tools

        let inputEntries = suffixEntries(entries, after: state.transcript)
        guard !inputEntries.isEmpty else {
            sink.emit(.done(model: modelId))
            return
        }
        var completionInfo: GenerateCompletionInfo?
        var generatedText = ""
        var generatedToolCalls: [ToolCall] = []
        for try await item in state.session.streamDetails(to: inputEntries.map(\.message)) {
            if sink.isCancelled {
                sink.emit(.done(model: modelId))
                return
            }
            switch item {
            case .chunk(let chunk):
                if !chunk.isEmpty {
                    generatedText += chunk
                    sink.emit(.delta(chunk))
                }
            case .info(let info):
                completionInfo = info
            case .toolCall(let toolCall):
                let indexed = ensureToolCallId(toolCall, index: generatedToolCalls.count)
                generatedToolCalls.append(indexed)
                sink.emit(.toolCall(indexed, index: generatedToolCalls.count - 1))
            }
        }
        updateTranscript(
            modelId: modelId,
            inputTranscript: entries.map(\.signature),
            generatedText: generatedText,
            generatedToolCalls: generatedToolCalls
        )
        sink.emit(.done(
            model: modelId,
            info: completionInfo,
            finishReason: generatedToolCalls.isEmpty ? nil : "tool_calls"
        ))
    }

    private func sessionState(
        modelId: String,
        container: ModelContainer,
        parameters: GenerateParameters,
        tools: [ToolSpec]?,
        toolsSignature: String,
        requestedTranscript: [String]
    ) async throws -> SessionState {
        if let state = sessions[modelId],
            state.toolsSignature == toolsSignature,
            hasPrefix(requestedTranscript, prefix: state.transcript)
        {
            state.session.generateParameters = parameters
            state.session.tools = tools
            return state
        }

        let session = ChatSession(container, generateParameters: parameters, tools: tools)
        let state = SessionState(session: session, transcript: [], toolsSignature: toolsSignature)
        sessions[modelId] = state
        return state
    }

    private func suffixEntries(_ entries: [ChatEntry], after transcript: [String]) -> [ChatEntry] {
        guard hasPrefix(entries.map(\.signature), prefix: transcript) else {
            return entries
        }
        return Array(entries.dropFirst(transcript.count))
    }

    private func updateTranscript(
        modelId: String,
        inputTranscript: [String],
        generatedText: String,
        generatedToolCalls: [ToolCall]
    ) {
        guard var state = sessions[modelId] else { return }
        state.transcript = inputTranscript + [assistantSignature(
            text: generatedText,
            toolCalls: generatedToolCalls
        )]
        sessions[modelId] = state
    }

    func download(_ model: String, sink: CallbackSink) async throws {
        let modelId = normalizeModelId(model)
        if sink.isCancelled {
            sink.emit(.done(model: modelId))
            return
        }
        guard let repo = Repo.ID(rawValue: modelId) else {
            throw BridgeError.invalidModelId(modelId)
        }
        sink.emit(.notice("downloading \(modelId)", model: modelId))
        let client = HubClient(userAgent: "codezal")
        _ = try await client.downloadSnapshot(
            of: repo,
            kind: .model,
            revision: "main",
            maxConcurrentDownloads: 3,
            progressHandler: { progress in
                sink.emit(.progress(
                    downloaded: progress.completedUnitCount,
                    total: progress.totalUnitCount
                ))
            }
        )
        if sink.isCancelled {
            sink.emit(.done(model: modelId))
            return
        }
        sink.emit(.done(model: modelId))
    }

    private func container(for modelId: String, sink: CallbackSink) async throws -> ModelContainer {
        if let existing = containers[modelId] {
            return existing
        }
        sink.emit(.notice("loading \(modelId)", model: modelId))
        let config = configuration(for: modelId)
        let container = try await LLMModelFactory.shared.loadContainer(
            from: #hubDownloader(),
            using: #huggingFaceTokenizerLoader(),
            configuration: config
        )
        containers[modelId] = container
        return container
    }
}

private enum BridgeError: LocalizedError {
    case emptyMessages
    case invalidModelId(String)
    case missingRequest

    var errorDescription: String? {
        switch self {
        case .emptyMessages:
            "No chat messages were provided"
        case .invalidModelId(let id):
            "Invalid Hugging Face model id: \(id)"
        case .missingRequest:
            "Missing request JSON"
        }
    }
}

private let runtime = CodezalMLXRuntime()

private func normalizeModelId(_ model: String?) -> String {
    let trimmed = (model ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || trimmed == "gemma4-e4b" {
        return "mlx-community/gemma-4-e4b-it-4bit"
    }
    switch trimmed {
    case "gemma4-12b-coder":
        return "mlx-community/gemma-4-12b-coder-fable5-composer2.5-4bit"
    case "gemma4-12b-coder-8bit":
        return "mlx-community/gemma-4-12b-coder-fable5-composer2.5-8bit"
    case "gemma4-12b":
        return "mlx-community/gemma-4-12B-it-OptiQ-4bit"
    case "gemma4-e2b":
        return "mlx-community/gemma-4-e2b-it-4bit"
    case "qwen3-4b":
        return "mlx-community/Qwen3-4B-4bit"
    case "qwen3-8b":
        return "mlx-community/Qwen3-8B-4bit"
    default:
        return trimmed
    }
}

private func configuration(for modelId: String) -> ModelConfiguration {
    switch modelId {
    case "mlx-community/gemma-4-e4b-it-4bit":
        return LLMRegistry.gemma4_e4b_it_4bit
    case "mlx-community/gemma-4-e2b-it-4bit":
        return LLMRegistry.gemma4_e2b_it_4bit
    case "mlx-community/Qwen3-4B-4bit":
        return LLMRegistry.qwen3_4b_4bit
    case "mlx-community/Qwen3-8B-4bit":
        return LLMRegistry.qwen3_8b_4bit
    case "mlx-community/Qwen3-1.7B-4bit":
        return LLMRegistry.qwen3_1_7b_4bit
    default:
        return LLMModelFactory.shared.configuration(id: modelId)
    }
}

@_cdecl("codezal_mlx_chat")
public func codezal_mlx_chat(
    _ requestCString: UnsafePointer<CChar>?,
    _ callback: CodezalMLXCallback?,
    _ userData: UnsafeMutableRawPointer?,
    _ shouldCancel: CodezalMLXCancel?,
    _ cancelData: UnsafeMutableRawPointer?
) -> Int32 {
    let sink = CallbackSink(
        callback: callback,
        userData: userData,
        shouldCancel: shouldCancel,
        cancelData: cancelData
    )
    guard let requestCString else {
        sink.emit(.error(BridgeError.missingRequest.localizedDescription))
        return 1
    }

    let json = String(cString: requestCString)
    let request: ChatRequest
    do {
        request = try JSONDecoder().decode(ChatRequest.self, from: Data(json.utf8))
    } catch {
        sink.emit(.error(error.localizedDescription))
        return 1
    }

    let semaphore = DispatchSemaphore(value: 0)
    let status = StatusBox()
    Task {
        do {
            try await runtime.run(request, sink: sink)
            status.set(0)
        } catch {
            sink.emit(.error(error.localizedDescription))
            status.set(1)
        }
        semaphore.signal()
    }
    semaphore.wait()
    return status.get()
}

@_cdecl("codezal_mlx_download")
public func codezal_mlx_download(
    _ modelCString: UnsafePointer<CChar>?,
    _ callback: CodezalMLXCallback?,
    _ userData: UnsafeMutableRawPointer?,
    _ shouldCancel: CodezalMLXCancel?,
    _ cancelData: UnsafeMutableRawPointer?
) -> Int32 {
    let sink = CallbackSink(
        callback: callback,
        userData: userData,
        shouldCancel: shouldCancel,
        cancelData: cancelData
    )
    guard let modelCString else {
        sink.emit(.error(BridgeError.missingRequest.localizedDescription))
        return 1
    }

    let model = String(cString: modelCString)
    let semaphore = DispatchSemaphore(value: 0)
    let status = StatusBox()
    Task {
        do {
            try await runtime.download(model, sink: sink)
            status.set(0)
        } catch {
            sink.emit(.error(error.localizedDescription))
            status.set(1)
        }
        semaphore.signal()
    }
    semaphore.wait()
    return status.get()
}
