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
import type { Meta } from "./captions";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

const SocialChip: React.FC<{
  icon: string;
  handle: string;
  accent: string;
  delay: number;
}> = ({ icon, handle, accent, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 200 } });

  return (
    <div
      style={{
        opacity: enter,
        transform: `translateY(${(1 - enter) * 20}px)`,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 30px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        border: `1px solid ${accent}`,
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: accent,
          color: "#0a0a12",
          fontWeight: 900,
          fontSize: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 30, fontWeight: 700, color: "#f5f5fa" }}>
        {handle}
      </span>
    </div>
  );
};

export const Outro: React.FC<{ meta: Meta }> = ({ meta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoEnter = spring({ frame, fps, config: { damping: 200 } });
  const messageOpacity = interpolate(frame, [14, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const messageY = interpolate(frame, [14, 40], [26, 0], {
    extrapolateRight: "clamp",
    easing: EASE,
  });

  const links = meta.links ?? {};

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(60% 60% at 50% 45%, rgba(168,85,247,0.30), transparent 70%), #04040a",
        justifyContent: "center",
        alignItems: "center",
        gap: 34,
      }}
    >
      <div
        style={{
          width: 300,
          height: 300,
          borderRadius: 999,
          overflow: "hidden",
          border: "3px solid rgba(255,255,255,0.85)",
          boxShadow: "0 0 70px rgba(168,85,247,0.6)",
          opacity: logoEnter,
          transform: `translateY(${(1 - logoEnter) * 24}px) scale(${0.9 + logoEnter * 0.1})`,
        }}
      >
        <Img
          src={staticFile("host.jpeg")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>

      <Img
        src={staticFile("logo.png")}
        style={{
          width: 240,
          opacity: logoEnter,
          transform: `translateY(${(1 - logoEnter) * 24}px)`,
        }}
      />

      <div
        style={{
          opacity: messageOpacity,
          transform: `translateY(${messageY}px)`,
          fontSize: 52,
          fontWeight: 800,
          color: "#ffffff",
        }}
      >
        それでは、また明日お会いしましょう。
      </div>

      <div style={{ display: "flex", gap: 26, alignItems: "center" }}>
        {links.note ? (
          <SocialChip icon="n" handle={links.note} accent="#41c9b4" delay={20} />
        ) : null}
        {links.x ? (
          <SocialChip icon="𝕏" handle={links.x} accent="#ffffff" delay={28} />
        ) : null}
        {links.spotify ? (
          <SocialChip
            icon="♪"
            handle={`Spotify: ${links.spotify}`}
            accent="#1db954"
            delay={36}
          />
        ) : null}
      </div>

      <div
        style={{
          opacity: messageOpacity * 0.7,
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: 4,
          color: "rgba(245,245,250,0.6)",
        }}
      >
        {meta.program}
      </div>
    </AbsoluteFill>
  );
};
