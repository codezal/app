"""OpenBench adapter for the Codezal harness.

Headless invocation (cwd = the disposable task workspace the runner passes):

    npx tsx <codezal-repo>/bench/headless.ts \
        --provider <id> --model <id> --instruction <instruction>

Notes / quirks:
- The agent loop is Codezal's real one (bench/runtime/agent.ts): shared system
  prompt + shared tool descriptions, i.e. the exact surface the RSI optimizer
  edits. The API key is resolved by the headless CLI itself from the OS
  keychain (same store the desktop app uses), so no keys live in this file.
- Token/turn accounting: the CLI ends stdout with one line
  `HEADLESS_RESULT {json}` carrying steps/toolCalls/inputTokens/outputTokens.
- The repo path is derived from this file's location
  (bench/obench-adapter/codezal.py -> repo root), override with CODEZAL_REPO.
- Model selection: MODELS maps a few canonical names; any other `--model`
  value of the form "provider/model" is passed through directly, e.g.
  `--model alibaba-token-plan/qwen3.8-max-preview`.
- Task success is decided by the runner's checker, never here.
"""

import json
import os
import subprocess
from pathlib import Path

NAME = "codezal"

# canonical model name -> Codezal provider/model pair
MODELS = {
    "qwen3.8-max": {"provider": "alibaba-token-plan", "model": "qwen3.8-max-preview"},
    "deepseek-v4-pro": {"provider": "deepseek", "model": "deepseek-v4-pro"},
    "kimi-k3": {"provider": "kimi-for-coding", "model": "k3"},
}

_REPO = Path(os.environ.get("CODEZAL_REPO", Path(__file__).resolve().parents[2]))
_HEADLESS = _REPO / "bench" / "headless.ts"


def _resolve_model(model: str) -> dict:
    if model in MODELS:
        return MODELS[model]
    if "/" in model:
        provider, model_id = model.split("/", 1)
        return {"provider": provider, "model": model_id}
    raise ValueError(
        f"unsupported model '{model}' — use one of {sorted(MODELS)} "
        "or pass-through 'provider/model'"
    )


def run(instruction: str, workdir: str, model: str, timeout_s: int) -> dict:
    try:
        ref = _resolve_model(model)
    except ValueError as e:
        return {
            "completed": False,
            "error": str(e),
            "output_tail": "",
            "tokens": None,
            "turns": None,
            "cmd": [],
        }

    cmd = [
        "npx", "tsx", str(_HEADLESS),
        "--provider", ref["provider"],
        "--model", ref["model"],
        "--instruction", instruction,
    ]
    env = dict(os.environ)
    # tsx must resolve from the Codezal repo's node_modules, not the temp workspace.
    env["PATH"] = f"{_REPO}/node_modules/.bin:" + env.get("PATH", "")

    try:
        proc = subprocess.run(
            cmd,
            cwd=workdir,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as e:
        tail = ((e.stdout or "") + (e.stderr or ""))[-2000:]
        return {
            "completed": False,
            "error": f"timeout after {timeout_s}s",
            "output_tail": tail,
            "tokens": None,
            "turns": None,
            "cmd": cmd,
        }

    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    tokens = turns = None
    for line in proc.stdout.splitlines():
        if line.startswith("HEADLESS_RESULT "):
            try:
                data = json.loads(line[len("HEADLESS_RESULT "):])
                tokens = (data.get("inputTokens") or 0) + (data.get("outputTokens") or 0)
                turns = data.get("steps")
                if data.get("error"):
                    return {
                        "completed": False,
                        "error": data["error"],
                        "output_tail": combined[-2000:],
                        "tokens": tokens,
                        "turns": turns,
                        "cmd": cmd,
                        "full_output": combined,
                    }
            except json.JSONDecodeError:
                pass

    return {
        "completed": proc.returncode == 0,
        "error": None if proc.returncode == 0 else f"exit {proc.returncode}",
        "output_tail": combined[-2000:],
        "tokens": tokens,
        "turns": turns,
        "cmd": cmd,
        "full_output": combined,
    }
