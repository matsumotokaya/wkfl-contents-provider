import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import type { Topic } from "./captions";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// Persistent visual for one topic. The image stays on screen for the whole
// topic span with a slow Ken Burns move; the headline label shows for the first
// few seconds and then fades, leaving the image up while the host talks.
export const TopicScene: React.FC<{
  topic: Topic;
  accent: string;
  lengthInFrames: number;
}> = ({ topic, accent, lengthInFrames }) => {
  const frame = useCurrentFrame();

  const scale = interpolate(frame, [0, lengthInFrames], [1.06, 1.16], {
    extrapolateRight: "clamp",
  });
  const panX = interpolate(frame, [0, lengthInFrames], [-1.6, 1.6], {
    extrapolateRight: "clamp",
  });

  const panelOpacity = interpolate(
    frame,
    [0, 12, lengthInFrames - 14, lengthInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const headlineOpacity = interpolate(
    frame,
    [10, 22, 150, 170],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE },
  );
  const headlineY = interpolate(frame, [10, 26], [22, 0], {
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 150,
          width: 1180,
          height: 520,
          opacity: panelOpacity,
          borderRadius: 24,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 34px 90px rgba(0,0,0,0.55)",
        }}
      >
        {topic.image ? (
          <Img
            src={staticFile(topic.image)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${scale}) translateX(${panX}%)`,
            }}
          />
        ) : (
          <AbsoluteFill
            style={{ background: `linear-gradient(135deg, ${accent}, #0a0a14)` }}
          />
        )}

        {/* Scrim for label legibility */}
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(5,5,12,0.35) 0%, transparent 22%, transparent 55%, rgba(5,5,12,0.88))",
          }}
        />

        {/* Top-left topic chip */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 28,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span
            style={{
              background: accent,
              color: "#0a0a12",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: 2,
              padding: "8px 22px 8px 28px",
              borderRadius: "0 10px 10px 0",
            }}
          >
            TOPIC {String(topic.no).padStart(2, "0")}
          </span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: 1,
              color: "rgba(255,255,255,0.9)",
              textShadow: "0 2px 8px rgba(0,0,0,0.85)",
            }}
          >
            {topic.media}
          </span>
        </div>

        {/* Headline at bottom of the image, shown briefly at the start */}
        <div
          style={{
            position: "absolute",
            left: 36,
            right: 36,
            bottom: 30,
            opacity: headlineOpacity,
            transform: `translateY(${headlineY}px)`,
            fontSize: 44,
            fontWeight: 800,
            lineHeight: 1.35,
            color: "#ffffff",
            textShadow: "0 4px 24px rgba(0,0,0,0.9)",
          }}
        >
          {topic.headline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
