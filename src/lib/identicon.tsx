// Deterministic pixel identicon — same seed always yields the same avatar.
// Used to give every agent/worker a stable visual identity across the running
// roster, message cards, and the transcript pane (no image assets, pure SVG).
//
// Layout: a 5x5 grid mirrored across the vertical axis (columns 0..2 decide,
// columns 3..4 mirror 1..0). Cell on/off comes from the hash bits; the fill
// color is derived from the same hash so identity + color stay in lockstep.

type IdenticonProps = {
  seed: string
  size?: number
  className?: string
}

// FNV-1a 32-bit hash — small, fast, dependency-free, stable across platforms.
// eslint-disable-next-line react-refresh/only-export-components
export function hashString(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    // 32-bit FNV prime multiply via shifts; keep unsigned with >>> 0.
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Hash → stable HSL color. Hue spans the wheel; saturation/lightness fixed so
// every avatar reads well on the dark UI background.
// eslint-disable-next-line react-refresh/only-export-components
export function identiconColor(seed: string): string {
  const hue = hashString(seed) % 360
  return `hsl(${hue}, 62%, 58%)`
}

// 5x5 boolean grid, vertically symmetric. Exported for testing without a DOM.
// eslint-disable-next-line react-refresh/only-export-components
export function identiconCells(seed: string): boolean[][] {
  const h = hashString(seed)
  const grid: boolean[][] = []
  // 15 decision bits: 3 columns (0..2) x 5 rows. Bit per cell from the hash.
  let bit = 0
  for (let row = 0; row < 5; row++) {
    const cols: boolean[] = [false, false, false, false, false]
    for (let col = 0; col < 3; col++) {
      const on = ((h >>> bit) & 1) === 1
      bit++
      cols[col] = on
      cols[4 - col] = on // mirror across the vertical axis
    }
    grid.push(cols)
  }
  return grid
}

// Pixel identicon as an inline SVG. Background is a subtle rounded tile so the
// avatar stays legible even when most cells are off.
export function Identicon({ seed, size = 20, className }: IdenticonProps) {
  const cells = identiconCells(seed)
  const color = identiconColor(seed)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 5 5"
      className={className}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <rect x="0" y="0" width="5" height="5" rx="1" className="fill-codezal-panel-2" />
      {cells.map((cols, row) =>
        cols.map((on, col) =>
          on ? (
            <rect key={`${row}-${col}`} x={col} y={row} width="1" height="1" fill={color} />
          ) : null,
        ),
      )}
    </svg>
  )
}
