import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// The episode audio is silent for the first ~5s, so the title card lives there.
export const INTRO_FRAMES = 150;

export const TitleIntro: React.FC<{
  program: string;
  title: string;
  date: string;
  lengthInFrames: number;
}> = ({ program, title, date, lengthInFrames }) => {
  const frame = useCurrentFrame();

  const overlayOut = interpolate(
    frame,
    [lengthInFrames - 18, lengthInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE },
  );

  const kicker = interpolate(frame, [6, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const kickerY = interpolate(frame, [6, 22], [18, 0], {
    extrapolateRight: "clamp",
    easing: EASE,
  });

  const titleOpacity = interpolate(frame, [18, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const titleY = interpolate(frame, [18, 48], [40, 0], {
    extrapolateRight: "clamp",
    easing: EASE,
  });

  const lineWidth = interpolate(frame, [40, 72], [0, 760], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });

  return (
    <AbsoluteFill
      style={{
        opacity: overlayOut,
        background:
          "radial-gradient(60% 60% at 50% 40%, rgba(168,85,247,0.28), transparent 70%), #04040a",
        justifyContent: "center",
        alignItems: "center",
        padding: 140,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
          maxWidth: 1500,
          textAlign: "center",
        }}
      >
        <Img
          src={staticFile("logo.png")}
          style={{
            width: 360,
            opacity: kicker,
            transform: `translateY(${kickerY}px)`,
          }}
        />

        <div
          style={{
            opacity: kicker,
            transform: `translateY(${kickerY}px)`,
            display: "flex",
            alignItems: "center",
            gap: 18,
            color: "#ff7a18",
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 8,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#ff7a18",
              boxShadow: "0 0 18px #ff7a18",
            }}
          />
          {program}
          <span style={{ opacity: 0.6, fontWeight: 600, letterSpacing: 4 }}>
            {date}
          </span>
        </div>

        <div
          style={{
            opacity: titleOpacity * 0.85,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 6,
            color: "rgba(245,245,250,0.7)",
          }}
        >
          本日のトップニュース
        </div>

        <div
          style={{
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            fontSize: 66,
            lineHeight: 1.45,
            fontWeight: 800,
            color: "#ffffff",
            textShadow: "0 6px 40px rgba(0,0,0,0.8)",
          }}
        >
          {title}
        </div>

        <div
          style={{
            width: lineWidth,
            height: 6,
            borderRadius: 999,
            background: "linear-gradient(90deg, #ff7a18, #a855f7 55%, #22d3ee)",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
