import type { IncomingMessage, ServerResponse } from 'node:http';
import { getQueryParams, resolveGoogleDriveDirectUrl, sendJson } from '../../lib/cloud-media';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const query = getQueryParams(req);
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
}
