import type { IncomingMessage, ServerResponse } from 'node:http';
import { BROWSER_UA, getQueryParams } from '../../lib/cloud-media';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const query = getQueryParams(req);
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
}
