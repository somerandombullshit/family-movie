import Hls from 'hls.js';
import {
  ArrowLeft,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatTime,
  getMovieProbeUrl,
  getMovieStreamUrl,
  normalizeDisplayTitle,
} from '../lib/format';
import type { MovieItem } from '../types';

interface VideoPlayerViewProps {
  movie: MovieItem;
  onBack: () => void;
}

export function VideoPlayerView({ movie, onBack }: VideoPlayerViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [streamKind, setStreamKind] = useState<
    'pending' | 'mp4' | 'hls' | 'gdrive_embed'
  >(movie.sourceType === 'direct_url' ? 'mp4' : 'pending');
  const [embedPreviewUrl, setEmbedPreviewUrl] = useState('');

  const streamUrl = getMovieStreamUrl(movie);
  const displayTitle = normalizeDisplayTitle(movie.title);

  const bumpControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3500);
  }, []);

  useEffect(() => {
    bumpControls();
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [bumpControls]);

  useEffect(() => {
    let cancelled = false;
    setErrorMessage('');
    setIsBuffering(true);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setEmbedPreviewUrl(
      movie.driveFileId
        ? `https://drive.google.com/file/d/${encodeURIComponent(movie.driveFileId)}/preview`
        : ''
    );

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (movie.sourceType === 'direct_url') {
      setStreamKind('mp4');
      return;
    }

    setStreamKind('pending');

    fetch(getMovieProbeUrl(movie))
      .then(async (res) => {
        if (cancelled) return;
        let data: {
          ready?: boolean;
          streamKind?: 'mp4' | 'hls' | 'gdrive_embed';
          previewUrl?: string;
          error?: string;
        } | null = null;
        try {
          data = (await res.json()) as {
            ready?: boolean;
            streamKind?: 'mp4' | 'hls' | 'gdrive_embed';
            previewUrl?: string;
            error?: string;
          };
        } catch {
          data = null;
        }

        if (!data) {
          setStreamKind('mp4');
          return;
        }

        if (!res.ok || !data.ready) {
          if (movie.sourceType === 'gdrive_file' && !data.error) {
            setStreamKind('mp4');
            return;
          }
          setErrorMessage(
            data.error ||
              'This movie could not start right now. Please tap Try Again.'
          );
          setIsBuffering(false);
          return;
        }
        if (data.previewUrl) {
          setEmbedPreviewUrl(data.previewUrl);
        }
        if (data.streamKind === 'gdrive_embed') {
          setStreamKind('gdrive_embed');
          setIsBuffering(false);
        } else if (data.streamKind === 'hls') {
          setStreamKind('hls');
        } else {
          setStreamKind('mp4');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStreamKind('mp4');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [movie, reloadKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (
      !video ||
      streamKind === 'pending' ||
      streamKind === 'gdrive_embed' ||
      errorMessage
    ) {
      return;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (streamKind === 'hls') {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hlsRef.current = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsBuffering(false);
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setIsBuffering(false);
            setErrorMessage(
              'Video playback was interrupted. Please tap Try Again.'
            );
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        void video.play().catch(() => {});
      } else {
        setIsBuffering(false);
        setErrorMessage('Your browser cannot play this video stream.');
      }
    } else {
      video.src = streamUrl;
      void video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamKind, streamUrl, errorMessage]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    bumpControls();
    if (video.paused || video.ended) {
      void video.play().catch(() => {
        setErrorMessage('Could not start playback. Please tap Try Again.');
      });
    } else {
      video.pause();
    }
  };

  const skipBy = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    bumpControls();
    const maxTime = Number.isFinite(video.duration)
      ? video.duration
      : currentTime + 30;
    video.currentTime = Math.max(
      0,
      Math.min(maxTime, video.currentTime + deltaSeconds)
    );
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    bumpControls();
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const handleSeek = (nextValue: number) => {
    const video = videoRef.current;
    if (!video) return;
    bumpControls();
    video.currentTime = nextValue;
    setCurrentTime(nextValue);
  };

  const handleBackClick = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
    onBack();
  };

  const controlsVisible =
    showControls || !isPlaying || isBuffering || Boolean(errorMessage);

  return (
    <div
      onMouseMove={bumpControls}
      onTouchStart={bumpControls}
      className="fixed inset-0 z-50 w-screen h-dvh bg-black text-white overflow-hidden select-none"
    >
      {/* Floating Top Bar */}
      <header
        className={`absolute top-0 left-0 right-0 z-20 px-4 sm:px-8 py-4 sm:py-5 bg-gradient-to-b from-black/85 via-black/45 to-transparent flex items-center justify-between gap-4 transition-opacity duration-200 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={() => void handleBackClick()}
          className="min-h-[52px] px-5 py-2.5 rounded-xl bg-[#1E2128]/95 hover:bg-[#2A2E38] border border-white/20 text-white text-base sm:text-lg font-semibold inline-flex items-center gap-2.5 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500"
        >
          <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
          <span>Back to Movies</span>
        </button>

        <h1 className="text-lg sm:text-2xl font-bold text-white truncate">
          {displayTitle}
        </h1>
      </header>

      {/* Edge-to-Edge Fullscreen Video Canvas */}
      <main className="w-full h-full flex items-center justify-center bg-black">
        {errorMessage ? (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-xl">
            <p className="text-xl sm:text-2xl font-semibold text-white leading-relaxed mb-6">
              {errorMessage}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="min-h-[56px] px-8 py-3 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-lg font-semibold transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500"
              >
                Try Again
              </button>
              {embedPreviewUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage('');
                    setStreamKind('gdrive_embed');
                  }}
                  className="min-h-[56px] px-6 py-3 rounded-xl bg-[#22262F] hover:bg-[#2D323E] text-white text-lg font-semibold transition-colors whitespace-nowrap"
                >
                  Try Drive Player
                </button>
              )}
              {movie.shareUrl && (
                <a
                  href={movie.shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[56px] px-6 py-3 rounded-xl bg-[#22262F] hover:bg-[#2D323E] text-white text-lg font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <span>Open Original Link</span>
                  <ExternalLink className="w-5 h-5" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        ) : streamKind === 'gdrive_embed' && embedPreviewUrl ? (
          <iframe
            src={embedPreviewUrl}
            title={displayTitle}
            allow="autoplay; fullscreen"
            allowFullScreen
            className="w-full h-full border-0"
          />
        ) : (
          <>
            <video
              key={`${movie.id}-${reloadKey}`}
              ref={videoRef}
              playsInline
              controls={false}
              onClick={togglePlay}
              onPlay={() => {
                setIsPlaying(true);
                setIsBuffering(false);
                bumpControls();
              }}
              onPause={() => {
                setIsPlaying(false);
                setShowControls(true);
              }}
              onWaiting={() => setIsBuffering(true)}
              onCanPlay={() => setIsBuffering(false)}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration)) setDuration(v.duration);
                setIsBuffering(false);
              }}
              onTimeUpdate={(e) => {
                setCurrentTime(e.currentTarget.currentTime);
              }}
              onError={() => {
                if (streamKind === 'pending') return;
                if (movie.sourceType === 'gdrive_file' && embedPreviewUrl) {
                  setIsBuffering(false);
                  setStreamKind('gdrive_embed');
                  return;
                }
                setIsBuffering(false);
                setErrorMessage(
                  'This video format could not play directly in your browser. For best results, upload MP4 files to Google Drive.'
                );
              }}
              className="w-full h-full object-contain cursor-pointer"
            />

            {isBuffering && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="px-6 py-4 rounded-xl bg-[#16181D] border border-white/15 text-lg font-medium text-white">
                  Loading movie…
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Auto-Hiding Bottom Senior-Friendly Controls Bar */}
      {streamKind !== 'gdrive_embed' && !errorMessage && (
        <footer
          aria-label="Movie Playback Controls"
          className={`absolute bottom-0 left-0 right-0 z-20 px-4 sm:px-8 pb-5 pt-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-200 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="max-w-4xl mx-auto bg-[#16181D]/90 backdrop-blur-md border border-white/15 rounded-2xl p-4 space-y-3">
            <div className="space-y-1.5">
              <input
                type="range"
                aria-label="Movie timeline"
                min={0}
                max={duration > 0 ? duration : 100}
                step={1}
                value={Math.min(currentTime, duration > 0 ? duration : 100)}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="w-full h-3.5 accent-[#2563EB] cursor-pointer"
              />
              <div className="flex items-center justify-between text-sm sm:text-base font-medium text-neutral-300 tabular-nums">
                <span>{formatTime(currentTime)}</span>
                <span>{duration > 0 ? formatTime(duration) : '--:--'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              <button
                type="button"
                onClick={togglePlay}
                className="min-h-[54px] px-5 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-lg font-bold inline-flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-6 h-6" aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-6 h-6 fill-current" aria-hidden="true" />
                    <span>Play</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => skipBy(-15)}
                className="min-h-[54px] px-4 py-2.5 rounded-xl bg-[#242832] hover:bg-[#2F3442] text-white text-base sm:text-lg font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
              >
                <RotateCcw className="w-5 h-5" aria-hidden="true" />
                <span>Back 15s</span>
              </button>

              <button
                type="button"
                onClick={() => skipBy(15)}
                className="min-h-[54px] px-4 py-2.5 rounded-xl bg-[#242832] hover:bg-[#2F3442] text-white text-base sm:text-lg font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
              >
                <RotateCw className="w-5 h-5" aria-hidden="true" />
                <span>Ahead 15s</span>
              </button>

              <button
                type="button"
                onClick={toggleMute}
                className="min-h-[54px] px-4 py-2.5 rounded-xl bg-[#242832] hover:bg-[#2F3442] text-white text-base sm:text-lg font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
              >
                {isMuted ? (
                  <>
                    <VolumeX className="w-5 h-5" aria-hidden="true" />
                    <span>Sound Off</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-5 h-5" aria-hidden="true" />
                    <span>Sound On</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
