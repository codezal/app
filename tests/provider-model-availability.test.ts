import { afterEach, describe, expect, it } from "vitest"
import { modelsFor } from "@/lib/providers"
import { _syncMlxModels } from "@/lib/providers/mlx"

describe("installed provider models", () => {
  afterEach(() => {
    _syncMlxModels([])
  })

  it("only exposes installed MLX models", () => {
    _syncMlxModels([])
    expect(modelsFor("mlx")).toEqual([])

    _syncMlxModels(["mlx-community/Qwen3-4B-4bit"])
    expect(modelsFor("mlx")).toEqual(["mlx-community/Qwen3-4B-4bit"])
  })
})
