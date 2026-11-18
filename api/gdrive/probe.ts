import type { IncomingMessage, ServerResponse } from 'node:http';
import { getQueryParams, openGoogleDriveDownloadStream, sendJson } from '../../lib/cloud-media';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const query = getQueryParams(req);
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
}
