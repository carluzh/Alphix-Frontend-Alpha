'use client'

export const HorizontalSonicLine = ({ noFade = false }: { noFade?: boolean }) => {
  return (
    <div className="relative w-full h-[2px]">
      <svg
        className="pointer-events-none absolute inset-0 w-full h-full"
        viewBox="0 0 1000 2"
        preserveAspectRatio="none"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line
          x1="0"
          y1="1"
          x2="1000"
          y2="1"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="2"
          strokeDasharray="6 4"
          className="animate-sonic-flow-horizontal-3"
        />
      </svg>
      {!noFade && (
        <>
          {/* Left fade */}
          <div
            className="absolute left-0 top-0 h-full w-96 pointer-events-none"
            style={{ background: 'linear-gradient(to right, rgb(13, 13, 12) 0%, transparent 100%)' }}
          />
          {/* Right fade */}
          <div
            className="absolute right-0 top-0 h-full w-96 pointer-events-none"
            style={{ background: 'linear-gradient(to left, rgb(13, 13, 12) 0%, transparent 100%)' }}
          />
        </>
      )}
    </div>
  )
}
