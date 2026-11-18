import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { Film } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AdminModal } from './components/AdminModal';
import { MovieCard } from './components/MovieCard';
import { VideoPlayerView } from './components/VideoPlayerView';
import { makeSafeDocId } from './lib/format';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import type { LibrarySettings, MovieItem, SyncedMoviePayload } from './types';

export default function App() {
  const [firestoreMovies, setFirestoreMovies] = useState<MovieItem[]>([]);
  const [liveFolderMovies, setLiveFolderMovies] = useState<MovieItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMovie, setSelectedMovie] = useState<MovieItem | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Subscribe to visible movies in Firestore (no authentication required for parents)
  useEffect(() => {
    const moviesQuery = query(collection(db, 'movies'), where('hidden', '==', false));
    const unsubscribe = onSnapshot(
      moviesQuery,
      (snapshot) => {
        const loaded: MovieItem[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: String(data.title || 'Untitled Movie'),
            fileName: String(data.fileName || ''),
            sourceType: data.sourceType,
            driveFileId: data.driveFileId,
            shareUrl: data.shareUrl,
            fsId: data.fsId,
            uk: data.uk,
            shareId: data.shareId,
            directUrl: data.directUrl,
            thumbnailUrl: data.thumbnailUrl,
            sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : undefined,
            durationLabel: data.durationLabel,
            hidden: Boolean(data.hidden),
            addedByUid: String(data.addedByUid || ''),
            createdAtMs: data.createdAt?.toMillis?.() || 0,
            updatedAtMs: data.updatedAt?.toMillis?.() || 0,
          };
        });
        loaded.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setFirestoreMovies(loaded);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'movies');
      }
    );

    return () => unsubscribe();
  }, []);

  // Quietly check connected Google Drive (or TeraBox) folder for newly uploaded movies
  useEffect(() => {
    let cancelled = false;

    const checkConnectedFolder = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'library'));
        if (!snap.exists() || cancelled) return;
        const settings = snap.data() as LibrarySettings;
        if (!settings.shareUrl) return;

        let endpoint = '';
        let payload: Record<string, string> = {};

        if (settings.connectionMode === 'gdrive_folder') {
          endpoint = '/api/gdrive/sync-folder';
          payload = { folderUrl: settings.shareUrl };
        } else if (settings.connectionMode === 'share_folder') {
          endpoint = '/api/terabox/sync-share';
          payload = { shareUrl: settings.shareUrl };
        } else {
          return;
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok || cancelled) return;

        const data = (await res.json()) as { movies?: SyncedMoviePayload[] };
        if (!Array.isArray(data.movies) || cancelled) return;

        const mapped: MovieItem[] = data.movies.map((m) => ({
          id: makeSafeDocId(
            m.driveFileId
              ? `gd_${m.driveFileId}`
              : m.fsId
                ? `tb_${m.fsId}`
                : `mov_${m.fileName}_${m.sizeBytes || 0}`
          ),
          title: m.title,
          fileName: m.fileName,
          sourceType: m.sourceType,
          driveFileId: m.driveFileId,
          shareUrl: m.shareUrl,
          fsId: m.fsId,
          uk: m.uk,
          shareId: m.shareId,
          thumbnailUrl: m.thumbnailUrl,
          sizeBytes: m.sizeBytes,
          hidden: false,
          addedByUid: 'sync',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        }));
        setLiveFolderMovies(mapped);
      } catch {
        // Silently rely on persisted Firestore movies if live folder check fails
      }
    };

    void checkConnectedFolder();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleMovies = useMemo(() => {
    const byId = new Map<string, MovieItem>();
    for (const m of firestoreMovies) {
      byId.set(m.id, m);
    }
    for (const live of liveFolderMovies) {
      if (!byId.has(live.id)) {
        byId.set(live.id, live);
      }
    }
    return Array.from(byId.values());
  }, [firestoreMovies, liveFolderMovies]);

  if (selectedMovie) {
    return (
      <VideoPlayerView
        movie={selectedMovie}
        onBack={() => setSelectedMovie(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F6F2] text-[#141413] flex flex-col">
      {/* Ultra-minimal Top Bar: Brand Title + Single Admin Button */}
      <header className="w-full border-b border-[#E4E2DC] bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="/"
            className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#141413] whitespace-nowrap shrink-0"
          >
            Family Cinema
          </a>

          <button
            type="button"
            onClick={() => setIsAdminOpen(true)}
            className="min-h-[44px] px-5 py-2 rounded-xl border border-[#D8D5CD] bg-[#FAF9F6] hover:bg-[#EFECE4] text-base font-semibold text-[#141413] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30"
          >
            Admin
          </button>
        </div>
      </header>

      {/* Main Parents' Movie Screen */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 sm:py-10">
        {loading ? (
          <div className="py-20 text-center">
            <p className="text-2xl font-semibold text-[#52504B]">
              Loading your movies…
            </p>
          </div>
        ) : visibleMovies.length === 0 ? (
          <div className="py-20 px-6 max-w-xl mx-auto text-center bg-white border border-[#E4E2DC] rounded-2xl space-y-4">
            <Film className="w-14 h-14 text-[#52504B] mx-auto" aria-hidden="true" />
            <h1 className="text-2xl sm:text-3xl font-bold text-[#141413]">
              No movies uploaded yet
            </h1>
            <p className="text-lg text-[#52504B] leading-relaxed">
              Once a movie is uploaded to Google Drive and connected in Admin, it will appear right here ready to watch.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#141413] tracking-tight">
              Movies Ready to Watch
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {visibleMovies.map((movie) => (
                <MovieCard
                  key={movie.id}
                  movie={movie}
                  onWatch={(chosen) => {
                    if (
                      !document.fullscreenElement &&
                      document.documentElement.requestFullscreen
                    ) {
                      void document.documentElement
                        .requestFullscreen()
                        .catch(() => {});
                    }
                    setSelectedMovie(chosen);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      <AdminModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
      />
    </div>
  );
}
