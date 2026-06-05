import "./index.css";
import { Composition, staticFile } from "remotion";
import { EpisodeVideo } from "./Episode";
import type { Episode, Meta } from "./captions";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="WKFL"
      component={EpisodeVideo}
      fps={FPS}
      width={1920}
      height={1080}
      durationInFrames={300}
      defaultProps={{
        episode: null as Episode | null,
        meta: null as Meta | null,
      }}
      calculateMetadata={async ({ props, abortSignal }) => {
        const [episode, meta]: [Episode, Meta] = await Promise.all([
          fetch(staticFile("episode.json"), { signal: abortSignal }).then((r) =>
            r.json(),
          ),
          fetch(staticFile("meta.json"), { signal: abortSignal }).then((r) =>
            r.json(),
          ),
        ]);

        // Add a short tail so the final caption/audio doesn't get cut off.
        const tailMs = 1200;
        const durationInFrames = Math.ceil(
          ((episode.total_duration_ms + tailMs) / 1000) * FPS,
        );

        return {
          durationInFrames,
          props: { ...props, episode, meta },
        };
      }}
    />
  );
};
