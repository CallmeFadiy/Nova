import { useEffect, useState } from "react";
import { coverTheme } from "../lib/colors";
import { initials } from "../lib/format";
import { coverUrl } from "../lib/tauri";
import type { Track } from "../types";

interface CoverProps {
  track: Track | null | undefined;
  className?: string;
  label?: string;
}

export function Cover({ track, className = "", label }: CoverProps) {
  const [failed, setFailed] = useState(false);
  const src = coverUrl(track);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <div className={`cover ${className}`}>
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  }

  const seed = track ? `${track.albumArtist}|${track.album}` : "Nova";
  const theme = coverTheme(seed);
  const caption = label ?? track?.album ?? "Nova";

  return (
    <div
      className={`cover cover-fallback ${className}`}
      style={{ background: theme.background, color: theme.ink }}
    >
      <span className="cover-accent" style={{ background: theme.accent }} />
      <span className="cover-initials">
        {initials(track?.album || track?.title || "Nova")}
      </span>
      <span className="cover-caption">{caption}</span>
    </div>
  );
}
