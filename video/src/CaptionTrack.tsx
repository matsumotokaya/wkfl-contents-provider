import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Caption } from "./captions";

const TOPIC_LABEL = (segmentIndex: number) =>
  `TOPIC ${String(segmentIndex + 1).padStart(2, "0")}`;

const TOPIC_COLORS = ["#ff7a18", "#a855f7", "#22d3ee"];

const CaptionCard: React.FC<{ caption: Caption; durationInFrames: number }> = ({
  caption,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const accent = TOPIC_COLORS[caption.segmentIndex % TOPIC_COLORS.length];

  const fade = interpolate(
    frame,
    [0, 7, durationInFrames - 7, durationInFrames],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    },
  );

  const rise = interpolate(frame, [0, 10], [22, 0], {
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill>
      {/* Dark scrim so the subtitle stays readable over busy visuals */}
      <AbsoluteFill
        style={{
          opacity: fade,
          background:
            "linear-gradient(180deg, transparent 46%, rgba(4,4,10,0.55) 70%, rgba(4,4,10,0.9) 100%)",
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 130,
        }}
      >
        <div
          style={{
            opacity: fade,
            transform: `translateY(${rise}px)`,
            maxWidth: 1480,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 26,
          }}
        >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 22px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
            border: `1px solid ${accent}`,
            color: accent,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 3,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: accent,
              boxShadow: `0 0 16px ${accent}`,
            }}
          />
          {TOPIC_LABEL(caption.segmentIndex)}
        </div>

        <div
          style={{
            fontSize: 50,
            lineHeight: 1.55,
            fontWeight: 700,
            color: "#f5f5fa",
            textAlign: "center",
            textShadow:
              "0 2px 5px rgba(0,0,0,0.95), 0 6px 30px rgba(0,0,0,0.85)",
          }}
        >
          {caption.text}
        </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const CaptionTrack: React.FC<{ captions: Caption[] }> = ({
  captions,
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      {captions.map((caption, index) => {
        const from = Math.round((caption.startMs / 1000) * fps);
        const end = Math.round((caption.endMs / 1000) * fps);
        const durationInFrames = Math.max(1, end - from);

        return (
          <Sequence key={index} from={from} durationInFrames={durationInFrames}>
            <CaptionCard caption={caption} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
