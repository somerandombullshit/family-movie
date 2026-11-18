import type { MovieItem } from '../types';

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${Math.max(1, Math.round(mb))} MB`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${mins}:${pad(secs)}`;
}

export function makeSafeDocId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  return cleaned || `movie_${Date.now()}`;
}

export function buildStreamQueryParams(movie: MovieItem): string {
  const params = new URLSearchParams();
  params.set('sourceType', movie.sourceType);
  if (movie.driveFileId) params.set('driveFileId', movie.driveFileId);
  if (movie.fileName) params.set('fileName', movie.fileName);
  if (movie.shareUrl) params.set('shareUrl', movie.shareUrl);
  if (movie.fsId) params.set('fsId', movie.fsId);
  if (movie.uk) params.set('uk', movie.uk);
  if (movie.shareId) params.set('shareId', movie.shareId);
  if (movie.directUrl) params.set('directUrl', movie.directUrl);
  return params.toString();
}

export function normalizeDisplayTitle(title: string): string {
  return title.replace(/\(\((\d{4})\)/g, '($1)').trim();
}

export function getMovieStreamUrl(movie: MovieItem): string {
  if (movie.sourceType === 'direct_url' && movie.directUrl) {
    return movie.directUrl;
  }
  if (movie.sourceType === 'gdrive_file' && movie.driveFileId) {
    return `/api/gdrive/stream?driveFileId=${encodeURIComponent(movie.driveFileId)}&fileName=${encodeURIComponent(movie.fileName || '')}`;
  }
  return `/api/terabox/stream?${buildStreamQueryParams(movie)}`;
}

export function getMovieProbeUrl(movie: MovieItem): string {
  if (movie.sourceType === 'gdrive_file' && movie.driveFileId) {
    return `/api/gdrive/probe?driveFileId=${encodeURIComponent(movie.driveFileId)}&fileName=${encodeURIComponent(movie.fileName)}`;
  }
  return `/api/terabox/probe?${buildStreamQueryParams(movie)}`;
}

export function getProxiedThumbnailUrl(movie: MovieItem): string {
  if (movie.sourceType === 'gdrive_file' && movie.driveFileId) {
    return `/api/gdrive/thumb?fileId=${encodeURIComponent(movie.driveFileId)}`;
  }
  const rawThumb = movie.thumbnailUrl;
  if (!rawThumb) return '';
  if (rawThumb.startsWith('/')) return rawThumb;
  return `/api/terabox/thumb?url=${encodeURIComponent(rawThumb)}`;
}
