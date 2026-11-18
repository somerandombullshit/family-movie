import {
  BROWSER_UA,
  collectMoviesFromDrive,
  collectMoviesFromShare,
  getHlsSegment,
  getQueryParams,
  getTeraBoxSessionNdus,
  readJsonBody,
  resolveTeraBoxStream,
  rewriteM3u8Playlist,
  sendJson,
  setTeraBoxSessionConfig,
} from '../lib/cloud-media.js';

export default async function handler(req, res) {
  const query = getQueryParams(req);
  const qAction = query.get('action') || (typeof req.query?.action === 'string' ? req.query.action : '');
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const action = qAction || pathname.split('/').filter(Boolean).pop() || '';

  if (action === 'session-config') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    const body = await readJsonBody(req);
    const hasServerCookie = setTeraBoxSessionConfig(
      typeof body.ndusCookie === 'string' ? body.ndusCookie : undefined,
      typeof body.passcode === 'string' ? body.passcode : undefined
    );
    sendJson(res, 200, { ok: true, hasServerCookie });
    return;
  }

  if (action === 'sync-share') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const shareUrl = typeof body.shareUrl === 'string' ? body.shareUrl : '';
      const passcode = typeof body.passcode === 'string' ? body.passcode : undefined;
      const ndusCookie = typeof body.ndusCookie === 'string' ? body.ndusCookie : undefined;

      if (!shareUrl.trim()) {
        sendJson(res, 400, { error: 'Please paste a TeraBox share link.' });
        return;
      }
      if (passcode || ndusCookie) {
        setTeraBoxSessionConfig(ndusCookie, passcode);
      }
      const movies = await collectMoviesFromShare(shareUrl, passcode, ndusCookie);
      sendJson(res, 200, { movies });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to TeraBox share link.';
      sendJson(res, 400, { error: message });
    }
    return;
  }

  if (action === 'sync-drive') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const ndusCookie = typeof body.ndusCookie === 'string' ? body.ndusCookie : '';
      const folderPath = typeof body.folderPath === 'string' ? body.folderPath : '/';
      const effectiveCookie = ndusCookie.trim() || getTeraBoxSessionNdus();

      if (!effectiveCookie) {
        sendJson(res, 400, { error: 'Please enter your TeraBox ndus cookie.' });
        return;
      }
      setTeraBoxSessionConfig(effectiveCookie, undefined);
      const movies = await collectMoviesFromDrive(effectiveCookie, folderPath || '/');
      sendJson(res, 200, { movies });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read your TeraBox folder.';
      sendJson(res, 400, { error: message });
    }
    return;
  }

  if (action === 'probe') {
    try {
      const sourceType = query.get('sourceType') || '';
      const shareUrl = query.get('shareUrl') || undefined;
      const fsId = query.get('fsId') || undefined;
      const directUrl = query.get('directUrl') || undefined;

      const resolved = await resolveTeraBoxStream({ sourceType, shareUrl, fsId, directUrl });
      sendJson(res, 200, { ready: true, streamKind: resolved.kind });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to prepare movie stream.';
      sendJson(res, 400, { ready: false, error: message });
    }
    return;
  }

  if (action === 'stream') {
    try {
      const sourceType = query.get('sourceType') || '';
      const shareUrl = query.get('shareUrl') || undefined;
      const fsId = query.get('fsId') || undefined;
      const directUrl = query.get('directUrl') || undefined;

      const resolved = await resolveTeraBoxStream({ sourceType, shareUrl, fsId, directUrl });
      if (resolved.kind === 'hls') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-store');
        res.end(resolved.playlistText);
        return;
      }

      res.statusCode = 302;
      res.setHeader('Location', resolved.streamUrl);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to stream movie.';
      sendJson(res, 502, { error: message });
    }
    return;
  }

  if (action === 'hls-segment') {
    const token = query.get('id') || '';
    const entry = getHlsSegment(token);
    if (!entry) {
      res.statusCode = 404;
      res.end();
      return;
    }

    try {
      const upstream = await fetch(entry.url, {
        method: 'GET',
        redirect: 'follow',
        headers: entry.headers,
      });
      if (!upstream.ok) {
        res.statusCode = upstream.status || 502;
        res.end();
        return;
      }

      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('mpegurl') || entry.url.includes('.m3u8')) {
        const subText = await upstream.text();
        if (subText.trim().startsWith('#EXTM3U')) {
          const rewritten = rewriteM3u8Playlist(subText, entry.url, entry.headers);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-store');
          res.end(rewritten);
          return;
        }
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', contentType || 'video/mp2t');
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
    } catch {
      res.statusCode = 502;
      res.end();
    }
    return;
  }

  if (action === 'thumb') {
    const rawUrl = query.get('url') || '';
    if (!rawUrl) {
      res.statusCode = 400;
      res.end();
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
        res.statusCode = 403;
        res.end();
        return;
      }

      const upstream = await fetch(parsed.toString(), {
        headers: {
          'User-Agent': BROWSER_UA,
          Referer: 'https://www.1024terabox.com/',
        },
      });
      if (!upstream.ok) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = 200;
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end();
    }
    return;
  }

  sendJson(res, 404, { error: 'Unknown TeraBox endpoint.' });
}
