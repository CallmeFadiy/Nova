import { ListMusic } from "lucide-react";
import type { Track } from "../types";
import { Cover } from "./Cover";

interface PlaylistMosaicProps {
  tracks: Track[];
  className?: string;
  large?: boolean;
}

export function PlaylistMosaic({
  tracks,
  className = "",
  large = false,
}: PlaylistMosaicProps) {
  const covers = tracks.slice(0, 4);
  return (
    <div className={`playlist-mosaic count-${covers.length} ${className}`}>
      {covers.map((track) => (
        <Cover
          key={track.id}
          track={track}
          className="playlist-mosaic-cover"
        />
      ))}
      {covers.length === 0 ? (
        <div className={`playlist-mosaic-empty${large ? " large" : ""}`}>
          <ListMusic size={large ? 26 : 18} />
        </div>
      ) : null}
    </div>
  );
}
