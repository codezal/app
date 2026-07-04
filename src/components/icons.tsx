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

export function CodezalBrandGlyph({ size = 22, className }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-block",
        flexShrink: 0,
        backgroundColor: "currentColor",
        WebkitMaskImage: "url(/codezal-glyph-1024.png)",
        maskImage: "url(/codezal-glyph-1024.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  )
}

export function CodezalGlyph({ size = 64, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M 40 26 Q 28 26 28 38 Q 28 50 18 50 Q 28 50 28 62 Q 28 74 40 74"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M 60 26 Q 72 26 72 38 Q 72 50 82 50 Q 72 50 72 62 Q 72 74 60 74"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <g transform="translate(50,50) scale(0.26) translate(-50,-50)">
        <path
          d="M 50.000,8.000 L 58.419,29.675 L 79.698,20.302 L 70.325,41.581 L 92.000,50.000 L 70.325,58.419 L 79.698,79.698 L 58.419,70.325 L 50.000,92.000 L 41.581,70.325 L 20.302,79.698 L 29.675,58.419 L 8.000,50.000 L 29.675,41.581 L 20.302,20.302 L 41.581,29.675 Z"
          fill="currentColor"
        />
      </g>
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
