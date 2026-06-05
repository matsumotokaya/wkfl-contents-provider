import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { buildCaptions, type Episode, type Meta } from "./captions";
import { CaptionTrack } from "./CaptionTrack";
import { TitleIntro, INTRO_FRAMES } from "./TitleIntro";
import { TopicScene } from "./TopicScene";
import { HostSpotlight } from "./HostSpotlight";
import { TopicTransition, TRANSITION_FRAMES } from "./TopicTransition";
import { Ticker } from "./Ticker";
import { Visualizer } from "./Visualizer";
import { Outro } from "./Outro";

const ACCENTS = ["#ff7a18", "#a855f7", "#22d3ee"];

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const x1 = 25 + Math.sin(t * 0.25) * 6;
  const y1 = 30 + Math.cos(t * 0.2) * 5;
  const x2 = 78 + Math.cos(t * 0.18) * 6;
  const y2 = 70 + Math.sin(t * 0.23) * 5;

  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(40% 50% at ${x1}% ${y1}%, rgba(168,85,247,0.35), transparent 70%),
          radial-gradient(45% 55% at ${x2}% ${y2}%, rgba(34,211,238,0.30), transparent 70%),
          radial-gradient(60% 60% at 50% 120%, rgba(255,122,24,0.22), transparent 70%),
          #07070d
        `,
      }}
    />
  );
};

const Header: React.FC<{ date: string }> = ({ date }) => {
  return (
    <AbsoluteFill style={{ padding: 70 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Img src={staticFile("logo.png")} style={{ height: 58 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: 2,
              color: "rgba(245,245,250,0.8)",
            }}
          >
            {date}
          </div>
          <div
            style={{
              width: 92,
              height: 92,
              borderRadius: 999,
              overflow: "hidden",
              border: "3px solid rgba(255,255,255,0.85)",
              boxShadow: "0 0 30px rgba(168,85,247,0.6)",
            }}
          >
            <Img
              src={staticFile("host.jpeg")}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC<{ totalMs: number }> = ({ totalMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;
  const progress = interpolate(currentMs, [0, totalMs], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div style={{ height: 8, background: "rgba(255,255,255,0.08)" }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "linear-gradient(90deg, #ff7a18, #a855f7 55%, #22d3ee)",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const EpisodeVideo: React.FC<{
  episode: Episode | null;
  meta: Meta | null;
}> = ({ episode, meta }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  if (!episode || !meta) {
    return <AbsoluteFill style={{ backgroundColor: "#07070d" }} />;
  }

  const captions = buildCaptions(episode);

  const headerOpacity = interpolate(
    frame,
    [INTRO_FRAMES - 30, INTRO_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const tickerItems = meta.topics.map(
    (t) => `TOPIC ${String(t.no).padStart(2, "0")}　${t.headline}`,
  );

  // Outro covers the silent tail after the host finishes speaking.
  const lastSegmentEndMs =
    episode.segments[episode.segments.length - 1]?.end_ms ??
    episode.total_duration_ms;
  const outroStart = Math.round((lastSegmentEndMs / 1000) * fps);
  const outroLength = Math.max(1, durationInFrames - outroStart);

  // Each topic image persists from its start until the next topic (or the
  // outro). The boundary cut is hidden by the topic transition stinger.
  const topicFrames = meta.topics.map((topic, i) => {
    const start = Math.round((topic.start_ms / 1000) * fps);
    const next = meta.topics[i + 1];
    const end = next ? Math.round((next.start_ms / 1000) * fps) : outroStart;
    return { start, length: Math.max(1, end - start) };
  });

  // Opening host spotlight runs from the title intro to the first topic.
  const firstTopicStart = topicFrames[0]?.start ?? outroStart;
  const hostLength = Math.max(1, firstTopicStart - INTRO_FRAMES);

  // Fade the broadcast UI out just before the outro takes over the screen.
  const outroFade = interpolate(
    frame,
    [outroStart - 12, outroStart],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#07070d" }}>
      <Background />
      <Visualizer />
      <Audio src={staticFile("episode.wav")} />

      <AbsoluteFill style={{ opacity: headerOpacity * outroFade }}>
        <Header date={meta.date} />
      </AbsoluteFill>

      <Sequence from={INTRO_FRAMES} durationInFrames={hostLength}>
        <HostSpotlight topics={meta.topics} program={meta.program} />
      </Sequence>

      {meta.topics.map((topic, i) => (
        <Sequence
          key={`scene-${topic.no}`}
          from={topicFrames[i].start}
          durationInFrames={topicFrames[i].length}
        >
          <TopicScene
            topic={topic}
            accent={ACCENTS[(topic.no - 1) % ACCENTS.length]}
            lengthInFrames={topicFrames[i].length}
          />
        </Sequence>
      ))}

      <CaptionTrack captions={captions} />

      <AbsoluteFill style={{ opacity: headerOpacity * outroFade }}>
        <Ticker items={tickerItems} label={meta.program} />
      </AbsoluteFill>

      {meta.topics.map((topic) => {
        const from = Math.round((topic.start_ms / 1000) * fps);
        return (
          <Sequence
            key={`tr-${topic.no}`}
            from={from - Math.round(TRANSITION_FRAMES * 0.5)}
            durationInFrames={TRANSITION_FRAMES}
          >
            <TopicTransition
              topicNo={topic.no}
              accent={ACCENTS[(topic.no - 1) % ACCENTS.length]}
            />
          </Sequence>
        );
      })}

      <AbsoluteFill style={{ opacity: outroFade }}>
        <ProgressBar totalMs={episode.total_duration_ms} />
      </AbsoluteFill>

      <Sequence from={0} durationInFrames={INTRO_FRAMES}>
        <TitleIntro
          program={meta.program}
          title={meta.title}
          date={meta.date}
          lengthInFrames={INTRO_FRAMES}
        />
      </Sequence>

      <Sequence from={outroStart} durationInFrames={outroLength}>
        <Outro meta={meta} />
      </Sequence>
    </AbsoluteFill>
  );
};
