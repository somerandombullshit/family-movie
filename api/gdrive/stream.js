import { getQueryParams, openGoogleDriveDownloadStream, sendJson } from '../../lib/cloud-media.js';

const MAX_VERCEL_CHUNK_BYTES = 3932160; // 3.75 MB per 206 Partial Content response (safely under Vercel 4.5 MB cap)

function resolveVideoContentType(rawType, fileName) {
  if (rawType && !rawType.includes('octet-stream') && !rawType.includes('text/')) {
    return rawType;
  }
  if (/\.webm$/i.test(fileName)) return 'video/webm';
  if (/\.mkv$/i.test(fileName)) return 'video/webm';
  if (/\.mov$/i.test(fileName)) return 'video/quicktime';
  return 'video/mp4';
}

export default async function handler(req, res) {
  const query = getQueryParams(req);
  const fileId = query.get('driveFileId') || '';
  const fileName = query.get('fileName') || '';
  if (!fileId || !/^[a-zA-Z0-9_-]{10,128}$/.test(fileId)) {
    sendJson(res, 400, { error: 'Invalid Google Drive file ID.' });
    return;
  }

  try {
    const rawRange = typeof req.headers.range === 'string' ? req.headers.range : '';
    let start = 0;
    let requestedEnd = null;
    const rangeMatch = rawRange.match(/^bytes=(\d+)-(\d*)$/);
    if (rangeMatch) {
      start = Number(rangeMatch[1]);
      if (rangeMatch[2]) {
        requestedEnd = Number(rangeMatch[2]);
      }
    }

    const cappedEnd =
      requestedEnd !== null
        ? Math.min(requestedEnd, start + MAX_VERCEL_CHUNK_BYTES - 1)
        : start + MAX_VERCEL_CHUNK_BYTES - 1;

    const upstreamRange = `bytes=${start}-${cappedEnd}`;
    const upstream = await openGoogleDriveDownloadStream(fileId, upstreamRange);

    if (upstream.status === 416) {
      await upstream.body?.cancel().catch(() => {});
      res.statusCode = 416;
      const cr = upstream.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      res.end();
      return;
    }

    if (!upstream.ok && upstream.status !== 206) {
      await upstream.body?.cancel().catch(() => {});
      sendJson(res, upstream.status, { error: `Google Drive returned HTTP ${upstream.status}.` });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    const contentType = resolveVideoContentType(upstream.headers.get('content-type') || '', fileName);
    const contentRange = upstream.headers.get('content-range');

    res.statusCode = upstream.status === 206 ? 206 : 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'no-store');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }
    res.end(buf);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to stream Google Drive video.';
    if (!res.headersSent) {
      sendJson(res, 502, { error: message });
    }
  }
}
