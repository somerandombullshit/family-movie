import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, resolveSingleGoogleDriveFile, sendJson } from '../../lib/cloud-media';

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
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
}
