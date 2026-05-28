// HSL ↔ hex conversion for the theme picker UI.
// Token storage uses "H S% L%" strings; <input type="color"> needs hex.

function parseHsl(hsl: string): { h: number; s: number; l: number } | null {
  const m = hsl.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/)
  if (!m) return null
  return { h: parseFloat(m[1]), s: parseFloat(m[2]), l: parseFloat(m[3]) }
}

export function hslToHex(hsl: string): string {
  const parsed = parseHsl(hsl)
  if (!parsed) return "#000000"
  const { h, s, l } = parsed
  const sN = s / 100
  const lN = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sN * Math.min(lN, 1 - lN)
  const f = (n: number) => {
    const v = lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(v * 255)
  }
  const r = f(0)
  const g = f(8)
  const b = f(4)
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")
}

export function hexToHsl(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
  if (!m) return "0 0% 0%"
  let r: number, g: number, b: number
  if (m[1].length === 3) {
    r = parseInt(m[1][0] + m[1][0], 16)
    g = parseInt(m[1][1] + m[1][1], 16)
    b = parseInt(m[1][2] + m[1][2], 16)
  } else {
    r = parseInt(m[1].slice(0, 2), 16)
    g = parseInt(m[1].slice(2, 4), 16)
    b = parseInt(m[1].slice(4, 6), 16)
  }
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  let s = 0
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rN:
        h = (gN - bN) / d + (gN < bN ? 6 : 0)
        break
      case gN:
        h = (bN - rN) / d + 2
        break
      case bN:
        h = (rN - gN) / d + 4
        break
    }
    h *= 60
  }
  const round = (n: number) => Math.round(n * 10) / 10
  return `${round(h)} ${round(s * 100)}% ${round(l * 100)}%`
}
