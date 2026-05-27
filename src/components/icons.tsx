// Codezal özel ikonlar — tasarımdaki 8-point sunburst marka + yardımcılar.
// Lucide kullanmadığımız bazı niş ihtiyaçlar.
type IconProps = { size?: number; className?: string }

export function CodezalMark({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
    >
      <g
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        <path d="M8 1.5v3.2M8 11.3v3.2M1.5 8h3.2M11.3 8h3.2M3.4 3.4l2.3 2.3M10.3 10.3l2.3 2.3M3.4 12.6l2.3-2.3M10.3 5.7l2.3-2.3" />
      </g>
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
    </svg>
  )
}

export function TrafficLights() {
  return (
    <div className="flex items-center gap-2">
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div
          key={c}
          className="h-3 w-3 rounded-full"
          style={{
            background: c,
            boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
          }}
        />
      ))}
    </div>
  )
}
