import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BROWSER_UA,
  collectMoviesFromGoogleDriveFolder,
  getQueryParams,
  openGoogleDriveDownloadStream,
  readJsonBody,
  resolveGoogleDriveDirectUrl,
  resolveSingleGoogleDriveFile,
  sendJson,
} from '../../lib/cloud-media';

type VercelRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

function getActionName(req: VercelRequest): string {
  const fromQuery = req.query?.action;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  if (Array.isArray(fromQuery) && fromQuery[0]) return fromQuery[0];
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  return pathname.split('/').filter(Boolean).pop() || '';
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  const action = getActionName(req);
  const query = getQueryParams(req);

  if (action === 'sync-folder') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const folderUrl = typeof body.folderUrl === 'string' ? body.folderUrl : '';
      if (!folderUrl.trim()) {
        sendJson(res, 400, { error: 'Please paste a Google Drive folder link.' });
        return;
      }
      const movies = await collectMoviesFromGoogleDriveFolder(folderUrl);
      sendJson(res, 200, { movies });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not read Google Drive folder.';
      sendJson(res, 400, { error: message });
    }
    return;
  }

  if (action === 'resolve-file') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const fileUrl = typeof body.fileUrl === 'string' ? body.fileUrl : '';
      if (!fileUrl.trim()) {
        sendJson(res, 400, { error: 'Please paste a Google Drive file link.' });
        return;
      }
      const movie = await resolveSingleGoogleDriveFile(fileUrl);
      sendJson(res, 200, { movie });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open Google Drive file.';
      sendJson(res, 400, { error: message });
    }
    return;
  }

  if (action === 'probe') {
    const fileId = query.get('driveFileId') || '';
    if (!fileId || !/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) {
      sendJson(res, 400, { ready: false, error: 'Missing Google Drive file ID.' });
      return;
    }

    const previewUrl = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;

    try {
      const testRes = await openGoogleDriveDownloadStream(fileId, 'bytes=0-1');
      await testRes.body?.cancel().catch(() => {});
      if (testRes.ok || testRes.status === 206) {
        sendJson(res, 200, { ready: true, streamKind: 'mp4', previewUrl });
      } else {
        sendJson(res, 200, { ready: true, streamKind: 'gdrive_embed', previewUrl });
      }
    } catch {
      sendJson(res, 200, { ready: true, streamKind: 'gdrive_embed', previewUrl });
    }
    return;
  }

  if (action === 'stream') {
    const fileId = query.get('driveFileId') || '';
    if (!fileId || !/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) {
      sendJson(res, 400, { error: 'Invalid Google Drive file ID.' });
      return;
    }

    try {
      const directUrl = await resolveGoogleDriveDirectUrl(fileId);
      res.statusCode = 302;
      res.setHeader('Location', directUrl);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to stream Google Drive video.';
      sendJson(res, 502, { error: message });
    }
    return;
  }

  if (action === 'thumb') {
    const fileId = query.get('fileId') || '';
    if (!fileId || !/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) {
      res.statusCode = 400;
      res.end();
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
        if (upstream.ok && ct.startsWith('image/')) {
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.statusCode = 200;
          res.setHeader('Content-Type', ct);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.end(buf);
          return;
        }
        await upstream.body?.cancel().catch(() => {});
      }
      res.statusCode = 404;
      res.end();
    } catch {
      res.statusCode = 404;
      res.end();
    }
    return;
  }

  sendJson(res, 404, { error: 'Unknown Google Drive endpoint.' });
}
