import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  createVisibleToolProtocolFilter,
  shouldStripVisibleToolProtocol,
  stripVisibleToolProtocolMessages,
  stripVisibleToolProtocolText,
} from "@/lib/stream/tool-protocol-filter";

describe("visible tool protocol filter", () => {
  it("removes function protocol blocks from visible text", () => {
    const text = [
      "Starting work.",
      "<function_calls><invoke><tool_name>spawn_agent</tool_name></invoke></function_calls>",
      "<function_results><result>debug-deep agent completed</result></function_results>",
      "Done.",
    ].join("\n");

    expect(stripVisibleToolProtocolText(text)).toBe(
      "Starting work.\n\n\nDone.",
    );
  });

  it("handles protocol markers split across streamed chunks", () => {
    const filter = createVisibleToolProtocolFilter();
    const chunks =
      "A <function_results><result>hidden</result></function_results> B".split(
        "",
      );
    const out =
      chunks.map((chunk) => filter.feed(chunk)).join("") + filter.flush();

    expect(out).toBe("A  B");
  });

  it("does not hang or leak an unterminated tool marker", () => {
    const filter = createVisibleToolProtocolFilter();
    expect(filter.feed("<tool_call\n")).toBe("");
    expect(filter.flush()).toBe("");
  });

  it("does not hide unrelated angle-bracket text", () => {
    const text =
      "Use <section> for markup and keep a <functionName> identifier.";
    expect(stripVisibleToolProtocolText(text)).toBe(text);
  });

  it("strips assistant protocol text from model history", () => {
    const messages = [
      { role: "user", content: "debug" },
      {
        role: "assistant",
        content:
          "Visible<function_results><result>hidden</result></function_results>",
      },
      {
        role: "assistant",
        content:
          "<function_results><result>only hidden</result></function_results>",
      },
    ] as ModelMessage[];

    expect(stripVisibleToolProtocolMessages(messages)).toEqual([
      { role: "user", content: "debug" },
      { role: "assistant", content: "Visible" },
    ]);
  });

  it("is enabled only for GLM-like tool streams", () => {
    expect(
      shouldStripVisibleToolProtocol("zhipuai-coding-plan", "glm-5.2", true),
    ).toBe(true);
    expect(shouldStripVisibleToolProtocol("openai", "gpt-5.2", true)).toBe(
      false,
    );
    expect(
      shouldStripVisibleToolProtocol("zhipuai-coding-plan", "glm-5.2", false),
    ).toBe(false);
  });
});
