import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Topic } from "./captions";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const ACCENTS = ["#ff7a18", "#a855f7", "#22d3ee"];

// Opening scene: the host photo shown large ("this person is talking") next to
// the day's line-up, covering the greeting + overview before topic 1 starts.
export const HostSpotlight: React.FC<{
  topics: Topic[];
  program: string;
}> = ({ topics, program }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const avatarEnter = spring({ frame, fps, config: { damping: 200 } });
  const float = Math.sin(frame / 26) * 8;

  return (
    <AbsoluteFill
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 90,
        paddingTop: 60,
      }}
    >
      {/* Large host portrait */}
      <div
        style={{
          opacity: avatarEnter,
          transform: `translateX(${(1 - avatarEnter) * -60}px) translateY(${float}px)`,
          width: 520,
          height: 640,
          borderRadius: 32,
          overflow: "hidden",
          border: "2px solid rgba(255,255,255,0.18)",
          boxShadow:
            "0 40px 110px rgba(0,0,0,0.55), 0 0 80px rgba(168,85,247,0.35)",
          position: "relative",
        }}
      >
        <Img
          src={staticFile("host.jpeg")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            left: 24,
            top: 24,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 18px",
            borderRadius: 999,
            background: "rgba(255,0,0,0.85)",
            color: "#fff",
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 3,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: "#fff",
            }}
          />
          ON AIR
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "60px 28px 24px",
            background:
              "linear-gradient(180deg, transparent, rgba(5,5,12,0.9))",
            fontSize: 34,
            fontWeight: 800,
            color: "#fff",
          }}
        >
          WKFL
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#ff7a18",
              marginLeft: 14,
              letterSpacing: 2,
            }}
          >
            {program}
          </span>
        </div>
      </div>

      {/* Line-up */}
      <div
        style={{
          width: 720,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div
          style={{
            opacity: interpolate(frame, [6, 22], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE,
            }),
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: 4,
            color: "#fff",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              width: 46,
              height: 6,
              borderRadius: 999,
              background: "#ff7a18",
            }}
          />
          本日のラインナップ
        </div>

        {topics.map((topic, i) => {
          const delay = 14 + i * 10;
          const enter = spring({
            frame: frame - delay,
            fps,
            config: { damping: 200 },
          });
          const accent = ACCENTS[i % ACCENTS.length];
          return (
            <div
              key={topic.no}
              style={{
                opacity: enter,
                transform: `translateX(${(1 - enter) * 50}px)`,
                display: "flex",
                alignItems: "center",
                gap: 24,
                padding: "22px 28px",
                borderRadius: 16,
                background: "rgba(12,12,20,0.66)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderLeft: `6px solid ${accent}`,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 40,
                  fontWeight: 900,
                  color: accent,
                  width: 64,
                }}
              >
                {String(topic.no).padStart(2, "0")}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  style={{ fontSize: 30, fontWeight: 700, color: "#f5f5fa" }}
                >
                  {topic.headline}
                </span>
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: 1,
                    color: "rgba(245,245,250,0.5)",
                  }}
                >
                  {topic.media}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
