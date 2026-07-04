export type MlxCatalogModel = {
  id: string
  label: string
  category: string
  blurb: string
  approxGB: number
}

export const MLX_CATALOG: MlxCatalogModel[] = [
  {
    id: "mlx-community/gemma-4-12b-coder-fable5-composer2.5-4bit",
    label: "Gemma 4 12B Coder 4-bit",
    category: "coding",
    blurb: "MLX 12B coder fine-tune for Apple Silicon",
    approxGB: 7.4,
  },
  {
    id: "mlx-community/gemma-4-12b-coder-fable5-composer2.5-8bit",
    label: "Gemma 4 12B Coder 8-bit",
    category: "coding",
    blurb: "Higher quality; requires more memory",
    approxGB: 13.5,
  },
  {
    id: "mlx-community/gemma-4-12B-it-OptiQ-4bit",
    label: "Gemma 4 12B IT 4-bit",
    category: "general",
    blurb: "General chat and instruction following",
    approxGB: 7.4,
  },
  {
    id: "mlx-community/gemma-4-e4b-it-4bit",
    label: "Gemma 4 E4B IT 4-bit",
    category: "general",
    blurb: "Fast, small Apple Silicon MLX model",
    approxGB: 3.2,
  },
  {
    id: "mlx-community/gemma-4-e2b-it-4bit",
    label: "Gemma 4 E2B IT 4-bit",
    category: "general",
    blurb: "Lightest Gemma 4 option",
    approxGB: 1.8,
  },
  {
    id: "mlx-community/Qwen3-8B-4bit",
    label: "Qwen3 8B 4-bit",
    category: "general",
    blurb: "Balanced general-purpose MLX model",
    approxGB: 5.0,
  },
  {
    id: "mlx-community/Qwen3-4B-4bit",
    label: "Qwen3 4B 4-bit",
    category: "general",
    blurb: "Low memory, fast responses",
    approxGB: 2.7,
  },
  {
    id: "mlx-community/Qwen3-1.7B-4bit",
    label: "Qwen3 1.7B 4-bit",
    category: "general",
    blurb: "Very lightweight test model",
    approxGB: 1.2,
  },
]

export const MLX_MODELS = MLX_CATALOG.map((m) => m.id)
