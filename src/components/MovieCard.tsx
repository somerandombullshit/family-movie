import { Film, Play } from 'lucide-react';
import { useState } from 'react';
import { formatBytes, getProxiedThumbnailUrl, normalizeDisplayTitle } from '../lib/format';
import type { MovieItem } from '../types';

interface MovieCardProps {
  movie: MovieItem;
  onWatch: (movie: MovieItem) => void;
}

export function MovieCard({ movie, onWatch }: MovieCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const thumbSrc = getProxiedThumbnailUrl(movie);
  const showThumbnail = Boolean(thumbSrc) && !imgFailed;
  const sizeLabel = formatBytes(movie.sizeBytes);
  const displayTitle = normalizeDisplayTitle(movie.title);

  return (
    <article
      onClick={() => onWatch(movie)}
      className="group bg-white border border-[#E4E2DC] rounded-2xl overflow-hidden flex flex-col cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 focus-within:ring-4 focus-within:ring-blue-600/30"
    >
      {/* 16:9 Thumbnail or Resilient Cinema Slate Fallback */}
      <div className="relative aspect-video w-full bg-[#181A20] overflow-hidden">
        {showThumbnail ? (
          <img
            src={thumbSrc}
            alt={displayTitle}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#1C1F26] to-[#111318]">
            <Film className="w-12 h-12 text-white/50 mb-3" aria-hidden="true" />
            <span className="text-lg font-semibold text-white/80 line-clamp-2">
              {displayTitle}
            </span>
          </div>
        )}
      </div>

      {/* Clear Large Title + Single Giant Watch Button */}
      <div className="p-6 flex-1 flex flex-col justify-between gap-5">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-[#141413] leading-snug line-clamp-2">
            {displayTitle}
          </h2>
          <p className="text-base text-[#52504B] tabular-nums">
            {[sizeLabel, movie.durationLabel, 'Ready to watch']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onWatch(movie);
          }}
          className="w-full min-h-[56px] px-6 py-3 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-lg font-bold inline-flex items-center justify-center gap-3 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/40"
        >
          <Play className="w-6 h-6 fill-current" aria-hidden="true" />
          <span>Watch Movie</span>
        </button>
      </div>
    </article>
  );
}
