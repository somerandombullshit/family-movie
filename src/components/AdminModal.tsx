import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Check,
  Eye,
  EyeOff,
  FolderSync,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes, makeSafeDocId } from '../lib/format';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import type { LibrarySettings, MovieItem, SyncedMoviePayload } from '../types';

const OWNER_EMAIL = 'poojith132photography@gmail.com';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ConnectTab = 'gdrive_folder' | 'single_movie' | 'terabox';

export function AdminModal({ isOpen, onClose }: AdminModalProps) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(false);

  const [activeTab, setActiveTab] = useState<ConnectTab>('gdrive_folder');
  const [driveFolderUrl, setDriveFolderUrl] = useState('');

  const [teraBoxUrl, setTeraBoxUrl] = useState('');
  const [passcode, setPasscode] = useState('');
  const [ndusCookie, setNdusCookie] = useState('');

  const [singleTitle, setSingleTitle] = useState('');
  const [singleUrl, setSingleUrl] = useState('');

  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [savedSettings, setSavedSettings] = useState<LibrarySettings | null>(null);

  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIsAdminVerified(false);
        return;
      }
      if (nextUser.email === OWNER_EMAIL && nextUser.emailVerified) {
        setIsAdminVerified(true);
        return;
      }
      setCheckingAdmin(true);
      try {
        const adminDoc = await getDoc(doc(db, 'admins', nextUser.uid));
        setIsAdminVerified(adminDoc.exists());
      } catch {
        setIsAdminVerified(false);
      } finally {
        setCheckingAdmin(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isOpen || !isAdminVerified || !user) return;

    const loadAdminData = async () => {
      try {
        const settingsSnap = await getDoc(doc(db, 'settings', 'library'));
        if (settingsSnap.exists()) {
          const data = settingsSnap.data() as LibrarySettings;
          setSavedSettings(data);
          if (data.connectionMode === 'gdrive_folder' && data.shareUrl) {
            setDriveFolderUrl(data.shareUrl);
            setActiveTab('gdrive_folder');
          } else if (data.shareUrl) {
            setTeraBoxUrl(data.shareUrl);
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'settings/library');
      }

      try {
        const secretSnap = await getDoc(doc(db, 'admin_secrets', 'terabox'));
        if (secretSnap.exists()) {
          const sec = secretSnap.data() as {
            ndusCookie?: string;
            passcode?: string;
          };
          if (sec.ndusCookie) setNdusCookie(sec.ndusCookie);
          if (sec.passcode) setPasscode(sec.passcode);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'admin_secrets/terabox');
      }
    };

    void loadAdminData();

    const unsubMovies = onSnapshot(
      collection(db, 'movies'),
      (snap) => {
        const list: MovieItem[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: String(data.title || 'Untitled'),
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
        list.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setMovies(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'movies');
      }
    );

    return () => unsubMovies();
  }, [isOpen, isAdminVerified, user]);

  if (!isOpen) return null;

  const handleSignIn = async () => {
    setStatusMessage(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Sign-in was cancelled.',
      });
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setStatusMessage(null);
  };

  const upsertSyncedMovies = async (
    synced: SyncedMoviePayload[],
    customTitleOverride?: string
  ) => {
    if (!user) return 0;
    const existingById = new Map(movies.map((m) => [m.id, m]));
    let addedCount = 0;

    for (const item of synced) {
      const docId = makeSafeDocId(
        item.driveFileId
          ? `gd_${item.driveFileId}`
          : item.fsId
            ? `tb_${item.fsId}`
            : `mov_${item.fileName}_${item.sizeBytes || 0}`
      );
      const existing = existingById.get(docId);
      const chosenTitle =
        customTitleOverride?.trim() ||
        existing?.title ||
        item.title.slice(0, 200) ||
        'Untitled Movie';

      if (existing) {
        const ref = doc(db, 'movies', docId);
        try {
          await updateDoc(ref, {
            title: chosenTitle.slice(0, 200),
            fileName: item.fileName.slice(0, 300),
            sourceType: item.sourceType,
            driveFileId: (item.driveFileId || '').slice(0, 128),
            shareUrl: (item.shareUrl || '').slice(0, 1000),
            fsId: (item.fsId || '').slice(0, 64),
            uk: (item.uk || '').slice(0, 64),
            shareId: (item.shareId || '').slice(0, 64),
            thumbnailUrl: (item.thumbnailUrl || '').slice(0, 2000),
            sizeBytes: Number(item.sizeBytes || 0),
            hidden: existing.hidden,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `movies/${docId}`);
        }
      } else {
        const ref = doc(db, 'movies', docId);
        try {
          await setDoc(ref, {
            title: chosenTitle.slice(0, 200),
            fileName: item.fileName.slice(0, 300),
            sourceType: item.sourceType,
            driveFileId: (item.driveFileId || '').slice(0, 128),
            shareUrl: (item.shareUrl || '').slice(0, 1000),
            fsId: (item.fsId || '').slice(0, 64),
            uk: (item.uk || '').slice(0, 64),
            shareId: (item.shareId || '').slice(0, 64),
            thumbnailUrl: (item.thumbnailUrl || '').slice(0, 2000),
            sizeBytes: Number(item.sizeBytes || 0),
            hidden: false,
            addedByUid: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          addedCount += 1;
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `movies/${docId}`);
        }
      }
    }

    return addedCount;
  };

  const handleSyncGoogleDriveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsBusy(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/gdrive/sync-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: driveFolderUrl.trim() }),
      });
      const data = (await res.json()) as {
        movies?: SyncedMoviePayload[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Could not sync Google Drive folder.');
      }

      const synced = data.movies || [];
      if (synced.length === 0) {
        throw new Error(
          'Connected to the Google Drive folder, but no video files (.mp4, .mkv, .mov) were found inside.'
        );
      }

      try {
        await setDoc(doc(db, 'settings', 'library'), {
          connectionMode: 'gdrive_folder',
          shareUrl: driveFolderUrl.trim().slice(0, 1000),
          folderPath: 'Google Drive',
          updatedByUid: user.uid,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'settings/library');
      }

      const added = await upsertSyncedMovies(synced);
      setStatusMessage({
        type: 'success',
        text: `Synced ${synced.length} movie${synced.length === 1 ? '' : 's'} from Google Drive (${added} new).`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to connect Google Drive folder.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddSingleMovie = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const trimmedUrl = singleUrl.trim();
    if (!trimmedUrl) return;

    setIsBusy(true);
    setStatusMessage(null);

    try {
      const isGoogleDrive = /drive\.google\.com/i.test(trimmedUrl);
      const isTeraBox =
        /terabox|1024terabox|4funbox|mirrobox|nephobox/i.test(trimmedUrl);

      if (isGoogleDrive) {
        if (/\/folders\//i.test(trimmedUrl)) {
          const res = await fetch('/api/gdrive/sync-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderUrl: trimmedUrl }),
          });
          const data = (await res.json()) as {
            movies?: SyncedMoviePayload[];
            error?: string;
          };
          if (!res.ok) throw new Error(data.error || 'Could not open Google Drive folder.');
          const synced = data.movies || [];
          if (synced.length === 0) throw new Error('No video files found in that folder.');
          await upsertSyncedMovies(synced, synced.length === 1 ? singleTitle : undefined);
          setStatusMessage({
            type: 'success',
            text: `Added ${synced.length} movie${synced.length === 1 ? '' : 's'} from Google Drive.`,
          });
        } else {
          const res = await fetch('/api/gdrive/resolve-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileUrl: trimmedUrl }),
          });
          const data = (await res.json()) as {
            movie?: SyncedMoviePayload;
            error?: string;
          };
          if (!res.ok || !data.movie) {
            throw new Error(data.error || 'Could not resolve Google Drive file.');
          }
          await upsertSyncedMovies([data.movie], singleTitle);
          setStatusMessage({
            type: 'success',
            text: `Added "${singleTitle.trim() || data.movie.title}" from Google Drive.`,
          });
        }
        setSingleTitle('');
        setSingleUrl('');
      } else if (isTeraBox) {
        const res = await fetch('/api/terabox/sync-share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shareUrl: trimmedUrl,
            passcode: passcode.trim(),
            ndusCookie: ndusCookie.trim(),
          }),
        });
        const data = (await res.json()) as {
          movies?: SyncedMoviePayload[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || 'Could not resolve TeraBox link.');
        const synced = data.movies || [];
        if (synced.length === 0) throw new Error('No video file found at that TeraBox link.');
        await upsertSyncedMovies(synced, synced.length === 1 ? singleTitle : undefined);
        setSingleTitle('');
        setSingleUrl('');
        setStatusMessage({
          type: 'success',
          text: `Added ${synced.length} movie${synced.length === 1 ? '' : 's'} from TeraBox.`,
        });
      } else {
        const title = singleTitle.trim() || 'Family Movie';
        const docId = makeSafeDocId(`direct_${Date.now()}`);
        try {
          await setDoc(doc(db, 'movies', docId), {
            title: title.slice(0, 200),
            fileName: title.slice(0, 300),
            sourceType: 'direct_url',
            directUrl: trimmedUrl.slice(0, 2000),
            hidden: false,
            addedByUid: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `movies/${docId}`);
        }
        setSingleTitle('');
        setSingleUrl('');
        setStatusMessage({ type: 'success', text: `Added "${title}".` });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to add movie.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSyncTeraBoxShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsBusy(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/terabox/sync-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareUrl: teraBoxUrl.trim(),
          passcode: passcode.trim(),
          ndusCookie: ndusCookie.trim(),
        }),
      });
      const data = (await res.json()) as {
        movies?: SyncedMoviePayload[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Could not sync TeraBox share link.');
      const synced = data.movies || [];
      if (synced.length === 0) throw new Error('No video files found in that TeraBox link.');

      try {
        await setDoc(doc(db, 'settings', 'library'), {
          connectionMode: 'share_folder',
          shareUrl: teraBoxUrl.trim().slice(0, 1000),
          folderPath: 'TeraBox',
          updatedByUid: user.uid,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'settings/library');
      }

      const added = await upsertSyncedMovies(synced);
      setStatusMessage({
        type: 'success',
        text: `Synced ${synced.length} movie${synced.length === 1 ? '' : 's'} from TeraBox (${added} new).`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to connect TeraBox.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveRename = async (movie: MovieItem) => {
    const nextTitle = editingTitle.trim();
    if (!nextTitle) return;
    try {
      await updateDoc(doc(db, 'movies', movie.id), {
        title: nextTitle.slice(0, 200),
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setEditingTitle('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `movies/${movie.id}`);
    }
  };

  const handleToggleHidden = async (movie: MovieItem) => {
    try {
      await updateDoc(doc(db, 'movies', movie.id), {
        hidden: !movie.hidden,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `movies/${movie.id}`);
    }
  };

  const handleDeleteMovie = async (movie: MovieItem) => {
    try {
      await deleteDoc(doc(db, 'movies', movie.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `movies/${movie.id}`);
    }
  };

  const handleQuickResync = async () => {
    if (!savedSettings?.shareUrl) return;
    if (savedSettings.connectionMode === 'gdrive_folder') {
      await handleSyncGoogleDriveFolder({
        preventDefault: () => {},
      } as React.FormEvent);
    } else if (savedSettings.connectionMode === 'share_folder') {
      await handleSyncTeraBoxShare({
        preventDefault: () => {},
      } as React.FormEvent);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-modal-title"
    >
      <div className="bg-white border border-[#E4E2DC] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#E4E2DC] flex items-center justify-between gap-4">
          <h2 id="admin-modal-title" className="text-xl font-bold text-[#141413]">
            Admin & Google Drive Connection
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Admin Panel"
            className="min-h-[44px] min-w-[44px] rounded-xl border border-[#E4E2DC] hover:bg-[#F7F6F2] flex items-center justify-center text-[#141413] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!user ? (
            <div className="py-10 text-center space-y-5 max-w-md mx-auto">
              <h3 className="text-xl font-bold text-[#141413]">
                Admin Sign-In Required
              </h3>
              <p className="text-base text-[#52504B] leading-relaxed">
                Sign in with your Google account to connect your Google Drive folder and manage movies for your parents.
              </p>
              <button
                type="button"
                onClick={handleSignIn}
                className="w-full min-h-[52px] px-6 py-3 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-base font-semibold transition-colors"
              >
                Sign in with Google
              </button>
            </div>
          ) : checkingAdmin ? (
            <div className="py-12 text-center text-base text-[#52504B]">
              Verifying admin access…
            </div>
          ) : !isAdminVerified ? (
            <div className="py-10 text-center space-y-4 max-w-md mx-auto">
              <h3 className="text-xl font-bold text-[#141413]">
                Access Restricted
              </h3>
              <p className="text-base text-[#52504B]">
                Signed in as{' '}
                <span className="font-semibold text-[#141413]">{user.email}</span>.
                Only the site owner can manage the movie library.
              </p>
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-[48px] px-6 py-2.5 rounded-xl border border-[#D8D5CD] hover:bg-[#F7F6F2] text-base font-semibold text-[#141413] inline-flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <>
              {/* Connection Tabs */}
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 p-1 bg-[#F2F0EA] rounded-xl">
                  <button
                    type="button"
                    onClick={() => setActiveTab('gdrive_folder')}
                    className={`flex-1 min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                      activeTab === 'gdrive_folder'
                        ? 'bg-white text-[#141413] shadow-sm'
                        : 'text-[#52504B] hover:text-[#141413]'
                    }`}
                  >
                    Google Drive Folder (15 GB Free)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('single_movie')}
                    className={`flex-1 min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                      activeTab === 'single_movie'
                        ? 'bg-white text-[#141413] shadow-sm'
                        : 'text-[#52504B] hover:text-[#141413]'
                    }`}
                  >
                    Add Single Movie
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('terabox')}
                    className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                      activeTab === 'terabox'
                        ? 'bg-white text-[#141413] shadow-sm'
                        : 'text-[#52504B] hover:text-[#141413]'
                    }`}
                  >
                    TeraBox
                  </button>
                </div>

                {activeTab === 'gdrive_folder' && (
                  <form
                    onSubmit={handleSyncGoogleDriveFolder}
                    className="space-y-4 bg-[#FAF9F6] border border-[#E4E2DC] rounded-xl p-5"
                  >
                    <div className="space-y-1.5 text-sm text-[#52504B] leading-relaxed">
                      <p>
                        <span className="font-semibold text-[#141413]">Step 1:</span>{' '}
                        Create a folder in Google Drive (e.g. <span className="font-semibold text-[#141413]">Family Movies</span>) and upload your movie files there.
                      </p>
                      <p>
                        <span className="font-semibold text-[#141413]">Step 2:</span>{' '}
                        Right-click the folder → <span className="font-semibold text-[#141413]">Share</span> → change General access to <span className="font-semibold text-[#141413]">Anyone with the link</span> → Copy link and paste it below. Any movie you upload to that folder will appear automatically for your parents.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="gd-folder-url"
                        className="block text-sm font-semibold text-[#141413]"
                      >
                        Google Drive Folder Link
                      </label>
                      <input
                        id="gd-folder-url"
                        type="url"
                        required
                        placeholder="https://drive.google.com/drive/folders/..."
                        value={driveFolderUrl}
                        onChange={(e) => setDriveFolderUrl(e.target.value)}
                        className="w-full min-h-[46px] px-3.5 rounded-lg border border-[#D8D5CD] bg-white text-base text-[#141413] focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isBusy}
                      className="min-h-[48px] px-6 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 text-white text-base font-semibold inline-flex items-center gap-2 transition-colors"
                    >
                      <FolderSync className="w-5 h-5" />
                      <span>
                        {isBusy
                          ? 'Connecting to Google Drive…'
                          : 'Connect & Sync Google Drive'}
                      </span>
                    </button>
                  </form>
                )}

                {activeTab === 'single_movie' && (
                  <form
                    onSubmit={handleAddSingleMovie}
                    className="space-y-4 bg-[#FAF9F6] border border-[#E4E2DC] rounded-xl p-5"
                  >
                    <p className="text-sm text-[#52504B] leading-relaxed">
                      Add one Google Drive video link (shared as &ldquo;Anyone with the link&rdquo;) or a direct MP4 link with a clean title for your parents.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="single-title"
                          className="block text-sm font-semibold text-[#141413]"
                        >
                          Movie Title (optional)
                        </label>
                        <input
                          id="single-title"
                          type="text"
                          placeholder="e.g. Baahubali (2015)"
                          value={singleTitle}
                          onChange={(e) => setSingleTitle(e.target.value)}
                          className="w-full min-h-[46px] px-3.5 rounded-lg border border-[#D8D5CD] bg-white text-base text-[#141413] focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          htmlFor="single-url"
                          className="block text-sm font-semibold text-[#141413]"
                        >
                          Google Drive or Direct Video Link
                        </label>
                        <input
                          id="single-url"
                          type="url"
                          required
                          placeholder="https://drive.google.com/file/d/.../view"
                          value={singleUrl}
                          onChange={(e) => setSingleUrl(e.target.value)}
                          className="w-full min-h-[46px] px-3.5 rounded-lg border border-[#D8D5CD] bg-white text-base text-[#141413] focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="min-h-[48px] px-6 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 text-white text-base font-semibold inline-flex items-center gap-2 transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                      <span>{isBusy ? 'Adding Movie…' : 'Add Movie'}</span>
                    </button>
                  </form>
                )}

                {activeTab === 'terabox' && (
                  <form
                    onSubmit={handleSyncTeraBoxShare}
                    className="space-y-4 bg-[#FAF9F6] border border-[#E4E2DC] rounded-xl p-5"
                  >
                    <p className="text-sm text-[#52504B] leading-relaxed">
                      Optional: Paste a TeraBox share link if you still want to sync movies from TeraBox. (Google Drive is recommended for reliable playback.)
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2 space-y-1.5">
                        <label
                          htmlFor="tb-share-url"
                          className="block text-sm font-semibold text-[#141413]"
                        >
                          TeraBox Share Link
                        </label>
                        <input
                          id="tb-share-url"
                          type="url"
                          required
                          placeholder="https://1024terabox.com/s/1..."
                          value={teraBoxUrl}
                          onChange={(e) => setTeraBoxUrl(e.target.value)}
                          className="w-full min-h-[46px] px-3.5 rounded-lg border border-[#D8D5CD] bg-white text-base text-[#141413] focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          htmlFor="tb-passcode"
                          className="block text-sm font-semibold text-[#141413]"
                        >
                          Passcode (optional)
                        </label>
                        <input
                          id="tb-passcode"
                          type="text"
                          maxLength={16}
                          placeholder="e.g. 1234"
                          value={passcode}
                          onChange={(e) => setPasscode(e.target.value)}
                          className="w-full min-h-[46px] px-3.5 rounded-lg border border-[#D8D5CD] bg-white text-base text-[#141413] focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="min-h-[48px] px-6 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 text-white text-base font-semibold inline-flex items-center gap-2 transition-colors"
                    >
                      <FolderSync className="w-5 h-5" />
                      <span>{isBusy ? 'Connecting…' : 'Sync TeraBox Link'}</span>
                    </button>
                  </form>
                )}

                {statusMessage && (
                  <div
                    role="status"
                    className={`p-4 rounded-xl border text-sm font-medium ${
                      statusMessage.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    {statusMessage.text}
                  </div>
                )}
              </div>

              {/* Movie Library Management */}
              <div className="space-y-3 pt-2 border-t border-[#E4E2DC]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-[#141413]">
                    Uploaded Movies ({movies.length})
                  </h3>
                  {savedSettings?.shareUrl && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleQuickResync}
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-[#D8D5CD] hover:bg-[#F7F6F2] text-sm font-semibold text-[#141413] inline-flex items-center gap-2 whitespace-nowrap"
                    >
                      <FolderSync className="w-4 h-4" />
                      <span>Sync Now</span>
                    </button>
                  )}
                </div>

                {movies.length === 0 ? (
                  <p className="text-sm text-[#52504B] py-4">
                    No movies added yet. Connect your Google Drive folder or add a movie link above.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#E4E2DC] border border-[#E4E2DC] rounded-xl overflow-hidden">
                    {movies.map((movie) => (
                      <li
                        key={movie.id}
                        className="p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          {editingId === movie.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                className="flex-1 min-h-[40px] px-3 rounded-lg border border-blue-600 text-base text-[#141413] focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveRename(movie)}
                                aria-label="Save title"
                                className="min-h-[40px] min-w-[40px] rounded-lg bg-[#1D4ED8] text-white flex items-center justify-center"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                aria-label="Cancel rename"
                                className="min-h-[40px] min-w-[40px] rounded-lg border border-[#D8D5CD] text-[#52504B] flex items-center justify-center"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="text-base font-semibold text-[#141413] truncate">
                                {movie.title}
                              </p>
                              <p className="text-xs text-[#52504B] truncate mt-0.5 tabular-nums">
                                {[
                                  movie.fileName,
                                  formatBytes(movie.sizeBytes),
                                  movie.hidden ? 'Hidden from parents' : 'Visible',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(movie.id);
                              setEditingTitle(movie.title);
                            }}
                            aria-label={`Rename ${movie.title}`}
                            className="min-h-[40px] px-3 rounded-lg border border-[#E4E2DC] hover:bg-[#F7F6F2] text-sm font-medium text-[#141413] inline-flex items-center gap-1.5"
                          >
                            <Pencil className="w-4 h-4" />
                            <span>Rename</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleHidden(movie)}
                            aria-label={
                              movie.hidden
                                ? `Show ${movie.title}`
                                : `Hide ${movie.title}`
                            }
                            className="min-h-[40px] px-3 rounded-lg border border-[#E4E2DC] hover:bg-[#F7F6F2] text-sm font-medium text-[#141413] inline-flex items-center gap-1.5"
                          >
                            {movie.hidden ? (
                              <>
                                <Eye className="w-4 h-4" />
                                <span>Show</span>
                              </>
                            ) : (
                              <>
                                <EyeOff className="w-4 h-4" />
                                <span>Hide</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteMovie(movie)}
                            aria-label={`Delete ${movie.title}`}
                            className="min-h-[40px] min-w-[40px] rounded-lg border border-[#E4E2DC] hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-[#52504B] flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {user && isAdminVerified && (
          <div className="px-6 py-4 border-t border-[#E4E2DC] bg-[#FAF9F6] flex items-center justify-between gap-4">
            <span className="text-sm text-[#52504B] truncate">
              Signed in as {user.email}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-[#D8D5CD] bg-white hover:bg-[#F7F6F2] text-sm font-semibold text-[#141413] inline-flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
