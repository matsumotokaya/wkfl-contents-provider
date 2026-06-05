import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import {
  AbsoluteFill,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const SAMPLES = 128;
const BARS = 48;

// Full-width reactive equalizer that sits low behind the captions so the frame
// is never static while the host is talking.
export const Visualizer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: staticFile("episode.wav"),
    frame,
    fps,
    windowInSeconds: 20,
  });

  if (!audioData) {
    return null;
  }

  const frequencies = visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples: SAMPLES,
    optimizeFor: "speed",
    dataOffsetInSeconds,
  });

  // Use the low/mid band (where speech energy lives) and mirror it for symmetry.
  const half = frequencies.slice(2, 2 + BARS);
  const bars = [...half].reverse().concat(half);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 5,
          width: "100%",
          height: 240,
          padding: "0 60px 80px",
          opacity: 0.4,
        }}
      >
        {bars.map((v, i) => {
          const height = Math.max(3, Math.min(1, v * 3.4) * 100);
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${height}%`,
                borderRadius: 6,
                background: "linear-gradient(180deg, #22d3ee, #a855f7)",
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
