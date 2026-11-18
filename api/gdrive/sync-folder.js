import { collectMoviesFromGoogleDriveFolder, readJsonBody, sendJson } from '../../lib/cloud-media.js';

export default async function handler(req, res) {
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
}
