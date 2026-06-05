import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// A big full-screen "stinger" that sweeps across at each topic boundary.
export const TRANSITION_FRAMES = 46;

export const TopicTransition: React.FC<{
  topicNo: number;
  accent: string;
}> = ({ topicNo, accent }) => {
  const frame = useCurrentFrame();

  // The skewed panel sweeps in from the left, holds, then exits to the right.
  const x = interpolate(frame, [0, 13, 26, 46], [-130, 0, 0, 130], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  const textOpacity = interpolate(
    frame,
    [8, 15, 25, 33],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const textX = interpolate(frame, [8, 26], [60, 0], {
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: "-12% -25%",
          transform: `translateX(${x}%) skewX(-9deg)`,
          background: `linear-gradient(115deg, ${accent} 0%, #0a0a14 72%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            transform: `skewX(9deg) translateX(${textX}px)`,
            opacity: textOpacity,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 44,
              fontWeight: 800,
              letterSpacing: 16,
              color: "rgba(10,10,20,0.85)",
            }}
          >
            TOPIC
          </div>
          <div
            style={{
              fontSize: 240,
              fontWeight: 900,
              lineHeight: 0.95,
              color: "#ffffff",
              textShadow: "0 14px 50px rgba(0,0,0,0.45)",
            }}
          >
            {String(topicNo).padStart(2, "0")}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
