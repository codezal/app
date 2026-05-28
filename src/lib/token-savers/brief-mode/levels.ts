// Brief Mode directives — injected into the system prompt to make the model
// respond more concisely. Three levels of compression. The directive itself is
// written in English because it speaks to the model; the chat language is
// orthogonal and stays as configured.
//
// Important: directives must never instruct the model to mangle code blocks,
// file paths, error strings, or command output. Verbatim technical content
// always wins over brevity.

import type { BriefModeLevel } from "../types"

const LITE = `## BRIEF MODE — LITE
Be concise. Drop pleasantries ("sure", "happy to", "of course") and filler
adverbs ("just", "really", "basically", "actually", "simply"). Skip
acknowledgements that restate the request. Keep technical content (code,
file paths, errors, commands) verbatim.`

const FULL = `## BRIEF MODE — FULL
Respond in compressed prose. Rules:
- Drop articles (a/an/the) when meaning stays clear.
- Drop pleasantries and filler adverbs.
- Drop hedging ("I think", "perhaps", "it seems"). State facts directly.
- Sentence fragments are fine. Pattern: [thing] [action] [reason]. [next step].
- Bullet lists welcome over prose paragraphs.
- Verbatim: code blocks, inline code, paths, errors, commands.
- Multi-step instructions and security/safety warnings get full clear sentences.`

const ULTRA = `## BRIEF MODE — ULTRA
Maximum compression while preserving correctness.
- Telegraph style. Fragments preferred.
- One idea per line.
- No prose intros, no summaries unless asked.
- Drop everything not essential to answer or action.
- Verbatim: code, paths, errors, commands.
- Drop compression for: security warnings, irreversible-action confirmations,
  multi-step sequences whose order risks misread.`

export function briefDirective(level: BriefModeLevel): string {
  switch (level) {
    case "lite":
      return LITE
    case "full":
      return FULL
    case "ultra":
      return ULTRA
  }
}
