import type { ModelMessage } from "ai";

type Rule = { open: string; close: string };

const BLOCK_RULES: Rule[] = [
  { open: "<function_calls", close: "</function_calls>" },
  { open: "<function_call", close: "</function_call>" },
  { open: "<function_results", close: "</function_results>" },
  { open: "<function_result", close: "</function_result>" },
  { open: "<tool_calls", close: "</tool_calls>" },
  { open: "<tool_call", close: "</tool_call>" },
  { open: "<tool_results", close: "</tool_results>" },
  { open: "<tool_result", close: "</tool_result>" },
];

const OPEN_MARKERS = BLOCK_RULES.map((r) => r.open);
const MAX_OPEN_LEN = Math.max(...OPEN_MARKERS.map((m) => m.length));

function isTagBoundary(ch: string | undefined): boolean {
  return ch === ">" || ch === "/" || (ch !== undefined && /\s/.test(ch));
}

function findNextRule(text: string): { index: number; rule: Rule } | null {
  let best: { index: number; rule: Rule } | null = null;
  for (const rule of BLOCK_RULES) {
    const index = text.indexOf(rule.open);
    if (index === -1) continue;
    const after = text[index + rule.open.length];
    if (!isTagBoundary(after)) continue;
    if (!best || index < best.index) best = { index, rule };
  }
  return best;
}

function safeEmitLen(text: string): number {
  const maxTail = Math.min(text.length, MAX_OPEN_LEN);
  for (let keep = maxTail; keep > 0; keep--) {
    const tail = text.slice(text.length - keep);
    if (OPEN_MARKERS.some((m) => m.startsWith(tail))) return text.length - keep;
  }
  return text.length;
}

export function shouldStripVisibleToolProtocol(
  providerId: string,
  modelId: string,
  toolsEnabled: boolean,
): boolean {
  if (!toolsEnabled) return false;
  const provider = providerId.toLowerCase();
  const model = modelId.toLowerCase();
  return (
    provider.includes("zai") ||
    provider.includes("zhipu") ||
    model.includes("glm")
  );
}

export function createVisibleToolProtocolFilter() {
  let buf = "";
  let close: string | null = null;

  const drain = (final: boolean): string => {
    let out = "";

    while (buf.length > 0) {
      if (close) {
        const end = buf.indexOf(close);
        if (end === -1) {
          if (final) {
            buf = "";
            close = null;
          }
          return out;
        }
        buf = buf.slice(end + close.length);
        close = null;
        continue;
      }

      const next = findNextRule(buf);
      if (!next) {
        const cut = final ? buf.length : safeEmitLen(buf);
        if (cut === 0) return out;
        out += buf.slice(0, cut);
        buf = buf.slice(cut);
        continue;
      }

      if (next.index > 0) {
        out += buf.slice(0, next.index);
        buf = buf.slice(next.index);
        continue;
      }

      if (!next.rule.close) {
        buf = buf.slice(next.rule.open.length);
        continue;
      }
      close = next.rule.close;
    }

    return out;
  };

  return {
    feed(piece: string): string {
      if (!piece) return "";
      buf += piece;
      return drain(false);
    },
    flush(): string {
      return drain(true);
    },
  };
}

export function stripVisibleToolProtocolText(text: string): string {
  const filter = createVisibleToolProtocolFilter();
  return filter.feed(text) + filter.flush();
}

export function stripVisibleToolProtocolMessages(
  messages: ModelMessage[],
): ModelMessage[] {
  let changed = false;
  const out: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      out.push(message);
      continue;
    }

    if (typeof message.content === "string") {
      const text = stripVisibleToolProtocolText(message.content);
      if (text !== message.content) changed = true;
      if (text)
        out.push(
          text === message.content
            ? message
            : ({ ...message, content: text } as ModelMessage),
        );
      else changed = true;
      continue;
    }

    if (Array.isArray(message.content)) {
      const parts: unknown[] = [];
      let partChanged = false;

      for (const part of message.content) {
        const rec = part as { type?: string; text?: unknown };
        if (rec.type === "text" && typeof rec.text === "string") {
          const text = stripVisibleToolProtocolText(rec.text);
          if (text !== rec.text) partChanged = true;
          if (text) parts.push(text === rec.text ? part : { ...rec, text });
          else partChanged = true;
          continue;
        }
        parts.push(part);
      }

      if (partChanged) changed = true;
      if (parts.length > 0) {
        out.push(
          partChanged
            ? ({ ...message, content: parts } as ModelMessage)
            : message,
        );
      } else {
        changed = true;
      }
      continue;
    }

    out.push(message);
  }

  return changed ? out : messages;
}
