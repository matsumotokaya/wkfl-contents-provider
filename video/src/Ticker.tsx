import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Bottom news ticker. The content is duplicated and scrolled with a modulo so
// it loops seamlessly. Width is estimated from character count (good enough for
// a continuous marquee).
export const Ticker: React.FC<{ items: string[]; label: string }> = ({
  items,
  label,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const content = items.join("　　　◆　　　");
  const fontSize = 28;
  const singleWidth = content.length * fontSize + 120;
  const speedPxPerSec = 130;
  const x = -(((frame / fps) * speedPxPerSec) % singleWidth);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 0,
          right: 0,
          height: 62,
          background: "rgba(6,6,12,0.94)",
          borderTop: "2px solid rgba(255,255,255,0.10)",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: "0 26px",
            background: "linear-gradient(120deg, #ff7a18, #ff9a3c)",
            color: "#0a0a12",
            fontWeight: 800,
            fontSize: 24,
            letterSpacing: 2,
            zIndex: 2,
          }}
        >
          AI NEWS
        </div>

        <div
          style={{ position: "relative", flex: 1, height: "100%", overflow: "hidden" }}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              transform: `translate(${x}px, -50%)`,
              whiteSpace: "nowrap",
              display: "flex",
              fontSize,
              fontWeight: 600,
              color: "#f5f5fa",
            }}
          >
            <span style={{ paddingLeft: 60 }}>{content}</span>
            <span style={{ paddingLeft: 60 }}>{content}</span>
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: "0 26px",
            color: "rgba(245,245,250,0.7)",
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: 3,
            borderLeft: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};
