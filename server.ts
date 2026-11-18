import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_UA,
  collectMoviesFromDrive,
  collectMoviesFromGoogleDriveFolder,
  collectMoviesFromShare,
  getHlsSegment,
  getTeraBoxSessionNdus,
  openGoogleDriveDownloadStream,
  resolveSingleGoogleDriveFile,
  resolveTeraBoxStream,
  rewriteM3u8Playlist,
  setTeraBoxSessionConfig,
} from './lib/cloud-media.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // --- Google Drive API Routes ---
  app.post('/api/gdrive/sync-folder', async (req: Request, res: Response) => {
    try {
      const { folderUrl } = (req.body || {}) as { folderUrl?: string };
      if (!folderUrl || !folderUrl.trim()) {
        res.status(400).json({ error: 'Please paste a Google Drive folder link.' });
        return;
      }
      const movies = await collectMoviesFromGoogleDriveFolder(folderUrl);
      res.json({ movies });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not read Google Drive folder.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/gdrive/resolve-file', async (req: Request, res: Response) => {
    try {
      const { fileUrl } = (req.body || {}) as { fileUrl?: string };
      if (!fileUrl || !fileUrl.trim()) {
        res.status(400).json({ error: 'Please paste a Google Drive file link.' });
        return;
      }
      const movie = await resolveSingleGoogleDriveFile(fileUrl);
      res.json({ movie });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open Google Drive file.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/gdrive/probe', async (req: Request, res: Response) => {
    const fileId = String(req.query.driveFileId || '');
    if (!fileId || !/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) {
      res.status(400).json({ ready: false, error: 'Missing Google Drive file ID.' });
      return;
    }

    const previewUrl = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;

    try {
      const testRes = await openGoogleDriveDownloadStream(fileId, 'bytes=0-1');
      await testRes.body?.cancel().catch(() => {});
      if (testRes.ok || testRes.status === 206) {
        res.json({ ready: true, streamKind: 'mp4', previewUrl });
      } else {
        res.json({ ready: true, streamKind: 'gdrive_embed', previewUrl });
      }
    } catch {
      res.json({ ready: true, streamKind: 'gdrive_embed', previewUrl });
    }
  });

  app.get('/api/gdrive/stream', async (req: Request, res: Response) => {
    const fileId = String(req.query.driveFileId || '');
    const fileName = String(req.query.fileName || '');
    if (!fileId || !/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) {
      res.status(400).json({ error: 'Invalid Google Drive file ID.' });
      return;
    }

    try {
      const upstream = await openGoogleDriveDownloadStream(fileId, req.headers.range);
      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).json({ error: `Google Drive returned HTTP ${upstream.status}.` });
        return;
      }

      const rawType = upstream.headers.get('content-type') || '';
      let contentType = rawType;
      if (!contentType || contentType.includes('octet-stream')) {
        if (/\.webm$/i.test(fileName)) contentType = 'video/webm';
        else if (/\.mkv$/i.test(fileName)) contentType = 'video/webm';
        else if (/\.mov$/i.test(fileName)) contentType = 'video/quicktime';
        else contentType = 'video/mp4';
      }

      const contentLength = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', acceptRanges);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (!upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as never);
      req.on('close', () => {
        nodeStream.destroy();
      });
      nodeStream.pipe(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to stream Google Drive video.';
      if (!res.headersSent) {
        res.status(502).json({ error: message });
      }
    }
  });

  app.get('/api/gdrive/thumb', async (req: Request, res: Response) => {
    const fileId = String(req.query.fileId || '');
    if (!fileId || !/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) {
      res.status(400).end();
      return;
    }
    try {
      const candidates = [
        `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w800`,
        `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w800`,
      ];
      for (const thumbUrl of candidates) {
        const upstream = await fetch(thumbUrl, {
          redirect: 'follow',
          headers: { 'User-Agent': BROWSER_UA },
        });
        const ct = upstream.headers.get('content-type') || '';
        if (upstream.ok && upstream.body && ct.startsWith('image/')) {
          res.setHeader('Content-Type', ct);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          const nodeStream = Readable.fromWeb(upstream.body as never);
          nodeStream.pipe(res);
          return;
        }
        await upstream.body?.cancel().catch(() => {});
      }
      res.status(404).end();
    } catch {
      res.status(404).end();
    }
  });

  // --- TeraBox API Routes (Kept as secondary option) ---
  app.post('/api/terabox/session-config', (req: Request, res: Response) => {
    const { ndusCookie, passcode } = (req.body || {}) as { ndusCookie?: string; passcode?: string };
    const hasServerCookie = setTeraBoxSessionConfig(ndusCookie, passcode);
    res.json({ ok: true, hasServerCookie });
  });

  app.post('/api/terabox/sync-share', async (req: Request, res: Response) => {
    try {
      const { shareUrl, passcode, ndusCookie } = (req.body || {}) as {
        shareUrl?: string;
        passcode?: string;
        ndusCookie?: string;
      };
      if (!shareUrl || !shareUrl.trim()) {
        res.status(400).json({ error: 'Please paste a TeraBox share link.' });
        return;
      }
      if (passcode || ndusCookie) {
        setTeraBoxSessionConfig(ndusCookie, passcode);
      }
      const movies = await collectMoviesFromShare(shareUrl, passcode, ndusCookie);
      res.json({ movies });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to TeraBox share link.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/terabox/sync-drive', async (req: Request, res: Response) => {
    try {
      const { ndusCookie, folderPath } = (req.body || {}) as {
        ndusCookie?: string;
        folderPath?: string;
      };
      const effectiveCookie = ndusCookie?.trim() || getTeraBoxSessionNdus();
      if (!effectiveCookie) {
        res.status(400).json({ error: 'Please enter your TeraBox ndus cookie.' });
        return;
      }
      setTeraBoxSessionConfig(effectiveCookie, undefined);
      const movies = await collectMoviesFromDrive(effectiveCookie, folderPath || '/');
      res.json({ movies });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read your TeraBox folder.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/terabox/probe', async (req: Request, res: Response) => {
    try {
      const sourceType = String(req.query.sourceType || '');
      const shareUrl = req.query.shareUrl ? String(req.query.shareUrl) : undefined;
      const fsId = req.query.fsId ? String(req.query.fsId) : undefined;
      const directUrl = req.query.directUrl ? String(req.query.directUrl) : undefined;

      const resolved = await resolveTeraBoxStream({ sourceType, shareUrl, fsId, directUrl });
      res.json({ ready: true, streamKind: resolved.kind });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to prepare movie stream.';
      res.status(400).json({ ready: false, error: message });
    }
  });

  app.get('/api/terabox/stream', async (req: Request, res: Response) => {
    try {
      const sourceType = String(req.query.sourceType || '');
      const shareUrl = req.query.shareUrl ? String(req.query.shareUrl) : undefined;
      const fsId = req.query.fsId ? String(req.query.fsId) : undefined;
      const directUrl = req.query.directUrl ? String(req.query.directUrl) : undefined;

      const resolved = await resolveTeraBoxStream({ sourceType, shareUrl, fsId, directUrl });
      if (resolved.kind === 'hls') {
        res.status(200);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-store');
        res.send(resolved.playlistText);
        return;
      }

      const upstreamHeaders: Record<string, string> = {
        ...((resolved.headers || {}) as Record<string, string>),
      };
      if (req.headers.range) upstreamHeaders['Range'] = req.headers.range;

      const upstream = await fetch(resolved.streamUrl || '', {
        method: 'GET',
        redirect: 'follow',
        headers: upstreamHeaders,
      });

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).json({ error: `Video stream unavailable (HTTP ${upstream.status}).` });
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'video/mp4';
      const contentLength = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType.startsWith('text/') ? 'video/mp4' : contentType);
      res.setHeader('Accept-Ranges', acceptRanges);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (!upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as never);
      req.on('close', () => nodeStream.destroy());
      nodeStream.pipe(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to stream movie.';
      if (!res.headersSent) res.status(502).json({ error: message });
    }
  });

  app.get('/api/terabox/hls-segment', async (req: Request, res: Response) => {
    const token = String(req.query.id || '');
    const entry = getHlsSegment(token);
    if (!entry) {
      res.status(404).end();
      return;
    }

    try {
      const upstream = await fetch(entry.url, {
        method: 'GET',
        redirect: 'follow',
        headers: entry.headers,
      });
      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status || 502).end();
        return;
      }

      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('mpegurl') || entry.url.includes('.m3u8')) {
        const subText = await upstream.text();
        if (subText.trim().startsWith('#EXTM3U')) {
          const rewritten = rewriteM3u8Playlist(subText, entry.url, entry.headers);
          res.status(200);
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-store');
          res.send(rewritten);
          return;
        }
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType || 'video/mp2t');
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const nodeStream = Readable.fromWeb(upstream.body as never);
      req.on('close', () => nodeStream.destroy());
      nodeStream.pipe(res);
    } catch {
      if (!res.headersSent) res.status(502).end();
    }
  });

  app.get('/api/terabox/thumb', async (req: Request, res: Response) => {
    const rawUrl = String(req.query.url || '');
    if (!rawUrl) {
      res.status(400).end();
      return;
    }
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      const allowedThumb =
        host.endsWith('terabox.com') ||
        host.endsWith('1024terabox.com') ||
        host.endsWith('teraboxcdn.com') ||
        host.endsWith('duboxcdn.com') ||
        host.endsWith('baidupcs.com') ||
        host.endsWith('bdimg.com') ||
        host.endsWith('nephobox.com');
      if (!allowedThumb) {
        res.status(403).end();
        return;
      }

      const upstream = await fetch(parsed.toString(), {
        headers: {
          'User-Agent': BROWSER_UA,
          Referer: 'https://www.1024terabox.com/',
        },
      });
      if (!upstream.ok || !upstream.body) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      const nodeStream = Readable.fromWeb(upstream.body as never);
      nodeStream.pipe(res);
    } catch {
      res.status(404).end();
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Family Cinema server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
