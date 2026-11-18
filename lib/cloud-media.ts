import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const TERABOX_ALLOWED_HOSTS = new Set([
  'terabox.com',
  'www.terabox.com',
  '1024terabox.com',
  'www.1024terabox.com',
  'teraboxapp.com',
  'www.teraboxapp.com',
  '4funbox.com',
  'www.4funbox.com',
  'mirrobox.com',
  'www.mirrobox.com',
  'nephobox.com',
  'www.nephobox.com',
  'teraboxshare.com',
  'www.teraboxshare.com',
  'teraboxlink.com',
  'www.teraboxlink.com',
  'freeterabox.com',
  'www.freeterabox.com',
  'teraboxurl.com',
  'www.teraboxurl.com',
]);

export const VIDEO_EXTENSIONS = /\.(mp4|mkv|webm|mov|m4v|avi|flv|ts|3gp|wmv)$/i;

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface SyncedMovieItem {
  driveFileId?: string;
  fsId: string;
  fileName: string;
  title: string;
  sizeBytes: number;
  thumbnailUrl: string;
  shareUrl: string;
  uk: string;
  shareId: string;
  sourceType: 'gdrive_file' | 'terabox_share' | 'terabox_drive';
}

// ============================================================================
// VERCEL / NODE HTTP HELPERS
// ============================================================================

export async function readJsonBody(req: IncomingMessage & { body?: unknown }): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function getQueryParams(req: IncomingMessage): URLSearchParams {
  const url = req.url || '/';
  const qIndex = url.indexOf('?');
  return new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '');
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

// ============================================================================
// GENERAL HELPERS
// ============================================================================

export function cleanMovieTitle(rawFileName: string): string {
  const withoutExt = rawFileName.replace(/\.[^.]+$/, '');
  const yearMatch = withoutExt.match(/(?:^|[.\s_\-(])(19\d{2}|20\d{2})(?:$|[.\s_\-)])/);
  const year = yearMatch ? yearMatch[1] : '';

  let cleaned = withoutExt
    .replace(
      /\b(2160p|1080p|720p|480p|360p|4k|uhd|hdr10?|hdrip|web-?dl|webrip|bluray|brrip|dvdrip|x264|x265|h264|h265|hevc|aac|ac3|dts|ddp5\.1|10bit|uncut|extended|remastered|dual[\s._-]?audio|esub|msub)\b/gi,
      ' '
    )
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (year) {
    cleaned = cleaned
      .replace(new RegExp(`[(\\[\\s]*\\b${year}\\b[)\\]\\s]*.*$`), '')
      .replace(/\(\s*$/, '')
      .trim();
    cleaned = cleaned ? `${cleaned} (${year})` : `(${year})`;
  }

  return cleaned || withoutExt || 'Untitled Movie';
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

export function extractCookiesFromHeaders(headers: Headers): Record<string, string> {
  const jar: Record<string, string> = {};
  const setCookies: string[] =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : [];

  for (const raw of setCookies) {
    const firstPart = raw.split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      if (k) jar[k] = v;
    }
  }
  return jar;
}

export function serializeCookieJar(jar: Record<string, string>): string {
  return Object.entries(jar)
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ============================================================================
// GOOGLE DRIVE HELPERS
// ============================================================================

export function extractGoogleDriveId(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (/^[a-zA-Z0-9_-]{15,128}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('google.com')) {
      return null;
    }
    const idParam = parsed.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]{10,128}$/.test(idParam)) {
      return idParam;
    }
    const folderMatch = parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]{10,128})/);
    if (folderMatch?.[1]) return folderMatch[1];

    const fileMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,128})/);
    if (fileMatch?.[1]) return fileMatch[1];

    return null;
  } catch {
    return null;
  }
}

async function listGoogleDriveEmbeddedFolder(folderId: string): Promise<{
  videos: SyncedMovieItem[];
  subfolders: string[];
}> {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`;
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (res.url.includes('accounts.google.com')) {
    throw new Error(
      'This Google Drive folder is private. In Google Drive, right-click the folder → Share → set General access to "Anyone with the link".'
    );
  }
  if (res.status === 404) {
    throw new Error('Google Drive folder not found. Please check that the folder link is correct.');
  }
  if (!res.ok) {
    throw new Error(`Google Drive returned status ${res.status}. Make sure the folder is shared as "Anyone with the link".`);
  }

  const html = await res.text();
  if (html.includes('ServiceLogin') || html.includes('accounts.google.com/v3/signin')) {
    throw new Error(
      'This Google Drive folder is private. In Google Drive, right-click the folder → Share → set General access to "Anyone with the link".'
    );
  }

  const videos: SyncedMovieItem[] = [];
  const subfolders: string[] = [];
  const seenIds = new Set<string>();

  const entryRegex = /<div class="flip-entry" id="entry-([a-zA-Z0-9_-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(html)) !== null) {
    const entryId = match[1];
    const href = match[2];
    const fileName = decodeHtmlEntities(match[3].trim());
    if (!entryId || seenIds.has(entryId)) continue;
    seenIds.add(entryId);

    if (href.includes('/folders/')) {
      subfolders.push(entryId);
    } else if (VIDEO_EXTENSIONS.test(fileName)) {
      videos.push({
        driveFileId: entryId,
        fsId: '',
        fileName,
        title: cleanMovieTitle(fileName),
        sizeBytes: 0,
        thumbnailUrl: `https://drive.google.com/thumbnail?id=${entryId}&sz=w800`,
        shareUrl: `https://drive.google.com/file/d/${entryId}/view`,
        uk: '',
        shareId: '',
        sourceType: 'gdrive_file',
      });
    }
  }

  if (videos.length === 0 && subfolders.length === 0) {
    const folderRes = await fetch(`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (folderRes.url.includes('accounts.google.com')) {
      throw new Error(
        'This Google Drive folder is private. In Google Drive, right-click the folder → Share → set General access to "Anyone with the link".'
      );
    }
    const folderHtml = await folderRes.text();
    const jsonEntryRegex = /\["([a-zA-Z0-9_-]{20,60})",\["[a-zA-Z0-9_-]+"(?:,"[a-zA-Z0-9_-]+")*\],"([^"]+)","([^"]+)"/g;
    let jMatch: RegExpExecArray | null;
    while ((jMatch = jsonEntryRegex.exec(folderHtml)) !== null) {
      const entryId = jMatch[1];
      const fileName = jMatch[2].replace(/\\u0026/g, '&').replace(/\\"/g, '"').trim();
      const mimeType = jMatch[3];
      if (!entryId || seenIds.has(entryId)) continue;
      seenIds.add(entryId);

      if (mimeType === 'application/vnd.google-apps.folder') {
        subfolders.push(entryId);
      } else if (mimeType.startsWith('video/') || VIDEO_EXTENSIONS.test(fileName)) {
        videos.push({
          driveFileId: entryId,
          fsId: '',
          fileName,
          title: cleanMovieTitle(fileName),
          sizeBytes: 0,
          thumbnailUrl: `https://drive.google.com/thumbnail?id=${entryId}&sz=w800`,
          shareUrl: `https://drive.google.com/file/d/${entryId}/view`,
          uk: '',
          shareId: '',
          sourceType: 'gdrive_file',
        });
      }
    }
  }

  return { videos, subfolders };
}

export async function collectMoviesFromGoogleDriveFolder(folderInput: string): Promise<SyncedMovieItem[]> {
  const folderId = extractGoogleDriveId(folderInput);
  if (!folderId) {
    throw new Error(
      'Please paste a valid Google Drive folder link (for example, https://drive.google.com/drive/folders/...).'
    );
  }

  const allVideos: SyncedMovieItem[] = [];
  const visitedFolders = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: folderId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visitedFolders.has(current.id)) continue;
    visitedFolders.add(current.id);

    const { videos, subfolders } = await listGoogleDriveEmbeddedFolder(current.id);
    allVideos.push(...videos);

    if (current.depth < 2) {
      for (const subId of subfolders) {
        if (!visitedFolders.has(subId)) {
          queue.push({ id: subId, depth: current.depth + 1 });
        }
      }
    }
  }

  return allVideos;
}

export async function resolveSingleGoogleDriveFile(fileInput: string): Promise<SyncedMovieItem> {
  const fileId = extractGoogleDriveId(fileInput);
  if (!fileId) {
    throw new Error(
      'Please paste a valid Google Drive file link (for example, https://drive.google.com/file/d/.../view).'
    );
  }

  const viewUrl = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  const res = await fetch(viewUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (res.url.includes('accounts.google.com')) {
    throw new Error(
      'This Google Drive video is private. In Google Drive, set Share → General access to "Anyone with the link".'
    );
  }
  if (res.status === 404) {
    throw new Error('Google Drive file not found. Please check the link.');
  }

  const html = await res.text();
  const ogTitle =
    html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ||
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ||
    'Movie.mp4';
  const rawName = decodeHtmlEntities(ogTitle.replace(/\s*-\s*Google Drive\s*$/i, '').trim());
  const fileName = rawName || 'Movie.mp4';

  return {
    driveFileId: fileId,
    fsId: '',
    fileName,
    title: cleanMovieTitle(fileName),
    sizeBytes: 0,
    thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`,
    shareUrl: viewUrl,
    uk: '',
    shareId: '',
    sourceType: 'gdrive_file',
  };
}

function parseHiddenFormInputs(html: string): Record<string, string> {
  const inputs: Record<string, string> = {};
  const inputTags = html.match(/<input[^>]+type=["']hidden["'][^>]*>/gi) || [];
  for (const tag of inputTags) {
    const nameMatch = tag.match(/name=["']([^"']+)["']/i);
    const valMatch = tag.match(/value=["']([^"']*)["']/i);
    if (nameMatch?.[1]) {
      inputs[nameMatch[1]] = decodeHtmlEntities(valMatch?.[1] || '');
    }
  }
  return inputs;
}

export async function resolveGoogleDriveDirectUrl(fileId: string): Promise<string> {
  const baseDownloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  const res = await fetch(baseDownloadUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent': BROWSER_UA,
      Range: 'bytes=0-1',
    },
  });

  const location = res.headers.get('location');
  if (location && res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => {});
    return location;
  }

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  if (ctype.includes('text/html')) {
    const cookies = extractCookiesFromHeaders(res.headers);
    const html = await res.text();
    const formInputs = parseHiddenFormInputs(html);
    const actionMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
    const confirmParam = formInputs.confirm || html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1];
    const uuidParam = formInputs.uuid || html.match(/uuid=([0-9A-Za-z_-]+)/)?.[1];

    const target = new URL(decodeHtmlEntities(actionMatch?.[1] || baseDownloadUrl));
    for (const [k, v] of Object.entries(formInputs)) {
      target.searchParams.set(k, v);
    }
    target.searchParams.set('id', fileId);
    target.searchParams.set('export', 'download');
    if (confirmParam) target.searchParams.set('confirm', confirmParam);
    if (uuidParam) target.searchParams.set('uuid', uuidParam);

    const retryHeaders: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Range: 'bytes=0-1',
    };
    const cookieStr = serializeCookieJar(cookies);
    if (cookieStr) retryHeaders['Cookie'] = cookieStr;

    const hop = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: retryHeaders,
    });
    const hopLocation = hop.headers.get('location');
    await hop.body?.cancel().catch(() => {});
    if (hopLocation && hop.status >= 300 && hop.status < 400) {
      return hopLocation;
    }

    return target.toString();
  }

  await res.body?.cancel().catch(() => {});
  return baseDownloadUrl;
}

export async function openGoogleDriveDownloadStream(
  fileId: string,
  rangeHeader?: string
): Promise<globalThis.Response> {
  const baseDownloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
  if (rangeHeader) headers['Range'] = rangeHeader;

  let upstream = await fetch(baseDownloadUrl, {
    method: 'GET',
    redirect: 'follow',
    headers,
  });

  const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
  if (ctype.includes('text/html')) {
    const cookies = extractCookiesFromHeaders(upstream.headers);
    const html = await upstream.text();
    const formInputs = parseHiddenFormInputs(html);
    const actionMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
    const confirmParam = formInputs.confirm || html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1];
    const uuidParam = formInputs.uuid || html.match(/uuid=([0-9A-Za-z_-]+)/)?.[1];

    if (confirmParam || Object.keys(formInputs).length > 0) {
      const target = new URL(decodeHtmlEntities(actionMatch?.[1] || baseDownloadUrl));
      for (const [k, v] of Object.entries(formInputs)) {
        target.searchParams.set(k, v);
      }
      target.searchParams.set('id', fileId);
      target.searchParams.set('export', 'download');
      if (confirmParam) target.searchParams.set('confirm', confirmParam);
      if (uuidParam) target.searchParams.set('uuid', uuidParam);

      const retryHeaders: Record<string, string> = { ...headers };
      const cookieStr = serializeCookieJar(cookies);
      if (cookieStr) retryHeaders['Cookie'] = cookieStr;

      upstream = await fetch(target.toString(), {
        method: 'GET',
        redirect: 'follow',
        headers: retryHeaders,
      });
      const retryCtype = (upstream.headers.get('content-type') || '').toLowerCase();
      if (retryCtype.includes('text/html')) {
        throw new Error('Google Drive virus-scan/quota page blocked direct download.');
      }
    } else {
      throw new Error('Google Drive returned HTML instead of video stream.');
    }
  }

  return upstream;
}

// ============================================================================
// TERABOX HELPERS (Optional Secondary)
// ============================================================================

let cachedSessionNdus = process.env.TERABOX_NDUS || '';
let cachedSessionPasscode = '';

export function setTeraBoxSessionConfig(ndusCookie?: string, passcode?: string): boolean {
  if (typeof ndusCookie === 'string') {
    cachedSessionNdus = ndusCookie.trim().replace(/^ndus=/i, '');
  }
  if (typeof passcode === 'string') {
    cachedSessionPasscode = passcode.trim();
  }
  return Boolean(cachedSessionNdus);
}

export function getTeraBoxSessionNdus(): string {
  return cachedSessionNdus;
}

interface HlsSegmentEntry {
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
}
const hlsSegmentCache = new Map<string, HlsSegmentEntry>();

export function getHlsSegment(token: string): HlsSegmentEntry | undefined {
  const entry = hlsSegmentCache.get(token);
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry;
}

export function registerHlsSegment(url: string, headers: Record<string, string>): string {
  const now = Date.now();
  if (hlsSegmentCache.size > 4000) {
    for (const [key, entry] of hlsSegmentCache.entries()) {
      if (entry.expiresAt < now) hlsSegmentCache.delete(key);
    }
    if (hlsSegmentCache.size > 4500) hlsSegmentCache.clear();
  }
  const token = crypto.createHash('sha256').update(url).digest('hex').slice(0, 24);
  hlsSegmentCache.set(token, { url, headers, expiresAt: now + 2 * 60 * 60 * 1000 });
  return token;
}

function parseSafeTeraBoxUrl(rawUrl: string): URL | null {
  try {
    const trimmed = rawUrl.trim();
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (!TERABOX_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractShortUrlCode(urlObj: URL): string | null {
  const surlParam = urlObj.searchParams.get('surl');
  if (surlParam) return surlParam.trim();
  const match = urlObj.pathname.match(/\/s\/([a-zA-Z0-9_-]+)/);
  return match?.[1]?.trim() || null;
}

function generateDpLogId(): string {
  const randomDigits = String(Math.floor(1000000000 + Math.random() * 9000000000));
  return `${Date.now()}${randomDigits.slice(0, 6)}`;
}

function buildBaseHeaders(cookieJar: Record<string, string>, referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: referer,
  };
  const cookieStr = serializeCookieJar(cookieJar);
  if (cookieStr) headers['Cookie'] = cookieStr;
  return headers;
}

function extractJsTokenFromHtml(html: string): string {
  const fnMatch =
    html.match(/fn%28%22([A-Za-z0-9]+)%22%29/) || html.match(/fn\("([A-Za-z0-9]+)"\)/);
  if (fnMatch?.[1]) return fnMatch[1];
  const jsTokenMatch = html.match(/jsToken["']?\s*[:=]\s*["']([A-Za-z0-9]+)["']/);
  return jsTokenMatch?.[1] || '';
}

function extractHtmlShareTokens(html: string) {
  let sign = '';
  let timestamp = '';
  let shareid = '';
  let uk = '';
  let bdstoken = '';
  let list: Record<string, unknown>[] = [];

  const signMatch = html.match(/["']sign["']\s*:\s*["']([a-f0-9A-F]+)["']/);
  if (signMatch?.[1]) sign = signMatch[1];
  const tsMatch = html.match(/["']timestamp["']\s*:\s*(\d{9,13})/);
  if (tsMatch?.[1]) timestamp = tsMatch[1];
  const shareIdMatch = html.match(/["']shareid["']\s*:\s*(\d+)/);
  if (shareIdMatch?.[1]) shareid = shareIdMatch[1];
  const ukMatch = html.match(/["']uk["']\s*:\s*(\d+)/);
  if (ukMatch?.[1]) uk = ukMatch[1];
  const bdsMatch = html.match(/["']bdstoken["']\s*:\s*["']([^"']+)["']/);
  if (bdsMatch?.[1]) bdstoken = bdsMatch[1];

  const msetMatch = html.match(/locals\.mset\((\{[\s\S]*?\})\);/);
  if (msetMatch?.[1]) {
    try {
      const parsed = JSON.parse(msetMatch[1]) as Record<string, unknown>;
      if (parsed.sign) sign = String(parsed.sign);
      if (parsed.timestamp) timestamp = String(parsed.timestamp);
      if (parsed.shareid) shareid = String(parsed.shareid);
      if (parsed.uk) uk = String(parsed.uk);
      if (parsed.bdstoken) bdstoken = String(parsed.bdstoken);
      const fileList = parsed.file_list as Record<string, unknown> | undefined;
      if (fileList && Array.isArray(fileList.list)) {
        list = fileList.list as Record<string, unknown>[];
      }
    } catch {
      // ignore
    }
  }

  return { sign, timestamp, shareid, uk, bdstoken, list };
}

function isVideoEntry(item: Record<string, unknown>): boolean {
  if (Number(item.isdir) === 1) return false;
  const filename = String(item.server_filename || item.filename || '');
  return Number(item.category) === 1 || VIDEO_EXTENSIONS.test(filename);
}

interface ShareSession {
  origin: string;
  shareUrl: string;
  shorturl: string;
  surlWithoutOne: string;
  cookieJar: Record<string, string>;
  jsToken: string;
  dpLogId: string;
  shareid: string;
  uk: string;
  sign: string;
  timestamp: string;
  list: Record<string, unknown>[];
}

async function resolveShareSession(
  rawShareUrl: string,
  passcode?: string,
  ndusCookie?: string
): Promise<ShareSession> {
  const parsed = parseSafeTeraBoxUrl(rawShareUrl);
  if (!parsed) throw new Error('Please enter a valid TeraBox share link.');
  const shorturl = extractShortUrlCode(parsed);
  if (!shorturl) throw new Error('Could not find a TeraBox share code (/s/...) in that URL.');
  const surlWithoutOne = shorturl.startsWith('1') ? shorturl.slice(1) : shorturl;
  const dpLogId = generateDpLogId();

  const cookieJar: Record<string, string> = { lang: 'en' };
  if (ndusCookie?.trim()) cookieJar.ndus = ndusCookie.trim().replace(/^ndus=/i, '');

  const pageRes = await fetch(parsed.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(serializeCookieJar(cookieJar) ? { Cookie: serializeCookieJar(cookieJar) } : {}),
    },
  });

  const finalUrl = new URL(pageRes.url || parsed.toString());
  const origin = `${finalUrl.protocol}//${finalUrl.host}`;
  Object.assign(cookieJar, extractCookiesFromHeaders(pageRes.headers));

  const html = await pageRes.text();
  const jsToken = extractJsTokenFromHtml(html);
  const htmlTokens = extractHtmlShareTokens(html);

  if (passcode?.trim()) {
    const verifyUrl = `${origin}/share/verify?surl=${encodeURIComponent(surlWithoutOne)}&t=${Date.now()}&app_id=250528&web=1&channel=dubox&clienttype=0`;
    const verifyRes = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        ...buildBaseHeaders(cookieJar, finalUrl.toString()),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ pwd: passcode.trim(), vcode: '', vcode_str: '' }).toString(),
    });
    Object.assign(cookieJar, extractCookiesFromHeaders(verifyRes.headers));
    const verifyJson = (await verifyRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (verifyJson.errno && Number(verifyJson.errno) !== 0) {
      throw new Error('Incorrect TeraBox share passcode.');
    }
  }

  let shareid = htmlTokens.shareid;
  let uk = htmlTokens.uk;
  let sign = htmlTokens.sign;
  let timestamp = htmlTokens.timestamp;
  let initialList: Record<string, unknown>[] = htmlTokens.list;

  for (const code of Array.from(new Set([shorturl, surlWithoutOne]))) {
    const infoUrl = new URL(`${origin}/api/shorturlinfo`);
    infoUrl.searchParams.set('app_id', '250528');
    infoUrl.searchParams.set('web', '1');
    infoUrl.searchParams.set('channel', 'dubox');
    infoUrl.searchParams.set('clienttype', '0');
    infoUrl.searchParams.set('dp-logid', dpLogId);
    infoUrl.searchParams.set('shorturl', code);
    infoUrl.searchParams.set('root', '1');
    if (jsToken) infoUrl.searchParams.set('jsToken', jsToken);

    const infoRes = await fetch(infoUrl.toString(), {
      headers: buildBaseHeaders(cookieJar, finalUrl.toString()),
    });
    Object.assign(cookieJar, extractCookiesFromHeaders(infoRes.headers));
    const infoJson = (await infoRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (Number(infoJson.errno) === -9 || Number(infoJson.errno) === -62) {
      throw new Error('This TeraBox link requires a passcode.');
    }
    if (Number(infoJson.errno) === 0) {
      shareid = String(infoJson.shareid || shareid || '');
      uk = String(infoJson.uk || uk || '');
      sign = String(infoJson.sign || sign || '');
      timestamp = String(infoJson.timestamp || timestamp || '');
      if (Array.isArray(infoJson.list) && infoJson.list.length > 0) {
        initialList = infoJson.list as Record<string, unknown>[];
      }
      break;
    }
  }

  if (initialList.length === 0 || !shareid || !uk) {
    const listUrl = new URL(`${origin}/share/list`);
    listUrl.searchParams.set('app_id', '250528');
    listUrl.searchParams.set('web', '1');
    listUrl.searchParams.set('channel', 'dubox');
    listUrl.searchParams.set('clienttype', '0');
    listUrl.searchParams.set('dp-logid', dpLogId);
    listUrl.searchParams.set('shorturl', surlWithoutOne);
    listUrl.searchParams.set('root', '1');
    listUrl.searchParams.set('page', '1');
    listUrl.searchParams.set('num', '100');
    listUrl.searchParams.set('order', 'name');
    if (jsToken) listUrl.searchParams.set('jsToken', jsToken);

    const listRes = await fetch(listUrl.toString(), {
      headers: buildBaseHeaders(cookieJar, finalUrl.toString()),
    });
    Object.assign(cookieJar, extractCookiesFromHeaders(listRes.headers));
    const listJson = (await listRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (Number(listJson.errno) === -9 || Number(listJson.errno) === -62) {
      throw new Error('This TeraBox link requires a passcode.');
    }
    if (Number(listJson.errno) !== 0 && !Array.isArray(listJson.list) && initialList.length === 0) {
      throw new Error(`TeraBox could not open this share link (code ${listJson.errno ?? 'unknown'}).`);
    }
    shareid = shareid || String(listJson.share_id || listJson.shareid || '');
    uk = uk || String(listJson.uk || '');
    if (Array.isArray(listJson.list) && listJson.list.length > 0) {
      initialList = listJson.list as Record<string, unknown>[];
    }
  }

  return {
    origin,
    shareUrl: finalUrl.toString(),
    shorturl,
    surlWithoutOne,
    cookieJar,
    jsToken,
    dpLogId,
    shareid,
    uk,
    sign,
    timestamp,
    list: initialList,
  };
}

async function listShareSubfolder(session: ShareSession, dirPath: string): Promise<Record<string, unknown>[]> {
  const listUrl = new URL(`${session.origin}/share/list`);
  listUrl.searchParams.set('app_id', '250528');
  listUrl.searchParams.set('web', '1');
  listUrl.searchParams.set('channel', 'dubox');
  listUrl.searchParams.set('clienttype', '0');
  listUrl.searchParams.set('dp-logid', session.dpLogId);
  listUrl.searchParams.set('shorturl', session.surlWithoutOne);
  if (session.shareid) listUrl.searchParams.set('shareid', session.shareid);
  if (session.uk) listUrl.searchParams.set('uk', session.uk);
  listUrl.searchParams.set('dir', dirPath);
  listUrl.searchParams.set('page', '1');
  listUrl.searchParams.set('num', '100');
  if (session.jsToken) listUrl.searchParams.set('jsToken', session.jsToken);

  const res = await fetch(listUrl.toString(), {
    headers: buildBaseHeaders(session.cookieJar, session.shareUrl),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return Array.isArray(json.list) ? (json.list as Record<string, unknown>[]) : [];
}

export async function collectMoviesFromShare(
  rawShareUrl: string,
  passcode?: string,
  ndusCookie?: string
): Promise<SyncedMovieItem[]> {
  const session = await resolveShareSession(
    rawShareUrl,
    passcode || cachedSessionPasscode,
    ndusCookie || cachedSessionNdus
  );
  const videos: SyncedMovieItem[] = [];
  const queue: { items: Record<string, unknown>[]; depth: number }[] = [{ items: session.list, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const item of current.items) {
      if (Number(item.isdir) === 1 && current.depth < 2 && item.path) {
        const subItems = await listShareSubfolder(session, String(item.path));
        queue.push({ items: subItems, depth: current.depth + 1 });
      } else if (isVideoEntry(item)) {
        const fileName = String(item.server_filename || item.filename || 'Movie.mp4');
        const thumbs = (item.thumbs || {}) as Record<string, string>;
        videos.push({
          fsId: String(item.fs_id || ''),
          fileName,
          title: cleanMovieTitle(fileName),
          sizeBytes: Number(item.size || 0),
          thumbnailUrl: thumbs.url3 || thumbs.url2 || thumbs.url1 || '',
          shareUrl: session.shareUrl,
          uk: session.uk,
          shareId: session.shareid,
          sourceType: 'terabox_share',
        });
      }
    }
  }

  return videos;
}

export async function collectMoviesFromDrive(ndusCookie: string, folderPath: string): Promise<SyncedMovieItem[]> {
  const cleanNdus = ndusCookie.trim().replace(/^ndus=/i, '');
  if (!cleanNdus) throw new Error('Please paste your TeraBox ndus cookie.');
  const normalizedPath = folderPath.trim()
    ? folderPath.trim().startsWith('/')
      ? folderPath.trim()
      : `/${folderPath.trim()}`
    : '/';

  const origin = 'https://www.1024terabox.com';
  const cookieJar: Record<string, string> = { ndus: cleanNdus, lang: 'en' };
  const mainRes = await fetch(`${origin}/main`, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: serializeCookieJar(cookieJar),
    },
  });
  Object.assign(cookieJar, extractCookiesFromHeaders(mainRes.headers));
  const jsToken = extractJsTokenFromHtml(await mainRes.text());

  const listUrl = new URL(`${origin}/api/list`);
  listUrl.searchParams.set('app_id', '250528');
  listUrl.searchParams.set('web', '1');
  listUrl.searchParams.set('channel', 'dubox');
  listUrl.searchParams.set('clienttype', '0');
  listUrl.searchParams.set('dir', normalizedPath);
  listUrl.searchParams.set('num', '100');
  listUrl.searchParams.set('page', '1');
  listUrl.searchParams.set('order', 'time');
  listUrl.searchParams.set('desc', '1');
  listUrl.searchParams.set('showempty', '0');
  if (jsToken) listUrl.searchParams.set('jsToken', jsToken);

  const listRes = await fetch(listUrl.toString(), {
    headers: buildBaseHeaders(cookieJar, `${origin}/main`),
  });
  const listJson = (await listRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (Number(listJson.errno) !== 0 || !Array.isArray(listJson.list)) {
    throw new Error(`TeraBox could not list folder "${normalizedPath}" (code ${listJson.errno ?? 'unknown'}).`);
  }

  return (listJson.list as Record<string, unknown>[]).filter(isVideoEntry).map((item) => {
    const fileName = String(item.server_filename || 'Movie.mp4');
    const thumbs = (item.thumbs || {}) as Record<string, string>;
    return {
      fsId: String(item.fs_id || ''),
      fileName,
      title: cleanMovieTitle(fileName),
      sizeBytes: Number(item.size || 0),
      thumbnailUrl: thumbs.url3 || thumbs.url2 || thumbs.url1 || '',
      shareUrl: '',
      uk: '',
      shareId: '',
      sourceType: 'terabox_drive' as const,
    };
  });
}

export function rewriteM3u8Playlist(
  rawPlaylist: string,
  baseUrl: string,
  headers: Record<string, string>
): string {
  return rawPlaylist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_match, rawUri: string) => {
          const abs = new URL(rawUri, baseUrl).toString();
          const token = registerHlsSegment(abs, headers);
          return `URI="/api/terabox/hls-segment?id=${token}"`;
        });
      }
      const absUrl = new URL(trimmed, baseUrl).toString();
      const token = registerHlsSegment(absUrl, headers);
      return `/api/terabox/hls-segment?id=${token}`;
    })
    .join('\n');
}

export type ResolvedStream =
  | { kind: 'mp4'; streamUrl: string; headers: Record<string, string> }
  | { kind: 'hls'; playlistText: string };

async function tryFetchGuestHlsPlaylist(session: ShareSession, fsId: string): Promise<string | null> {
  if (!session.uk || !session.shareid) return null;
  const streamTypes = ['M3U8_AUTO_720', 'M3U8_AUTO_480', 'M3U8_AUTO_360', 'M3U8_FLV_264_480'];
  for (const streamType of streamTypes) {
    const hlsUrl = new URL(`${session.origin}/share/streaming`);
    hlsUrl.searchParams.set('uk', session.uk);
    hlsUrl.searchParams.set('shareid', session.shareid);
    hlsUrl.searchParams.set('type', streamType);
    hlsUrl.searchParams.set('fid', fsId);
    if (session.sign) hlsUrl.searchParams.set('sign', session.sign);
    if (session.timestamp) hlsUrl.searchParams.set('timestamp', session.timestamp);
    hlsUrl.searchParams.set('esl', '1');
    hlsUrl.searchParams.set('isplayer', '1');
    hlsUrl.searchParams.set('ehps', '1');
    hlsUrl.searchParams.set('clienttype', '0');
    hlsUrl.searchParams.set('app_id', '250528');
    hlsUrl.searchParams.set('web', '1');
    hlsUrl.searchParams.set('channel', 'dubox');
    hlsUrl.searchParams.set('dp-logid', session.dpLogId);
    if (session.jsToken) hlsUrl.searchParams.set('jsToken', session.jsToken);

    const headers = buildBaseHeaders(session.cookieJar, session.shareUrl);
    const res = await fetch(hlsUrl.toString(), { headers });
    const bodyText = await res.text();
    if (bodyText.trim().startsWith('#EXTM3U')) {
      return rewriteM3u8Playlist(bodyText, hlsUrl.toString(), headers);
    }
  }
  return null;
}

export async function resolveTeraBoxStream(params: {
  sourceType: string;
  shareUrl?: string;
  fsId?: string;
  directUrl?: string;
  passcode?: string;
  ndusCookie?: string;
}): Promise<ResolvedStream> {
  const { sourceType, shareUrl, fsId, directUrl, passcode, ndusCookie } = params;
  if (sourceType === 'direct_url' && directUrl) {
    return { kind: 'mp4', streamUrl: directUrl, headers: { 'User-Agent': BROWSER_UA } };
  }

  const activeNdus = (ndusCookie || cachedSessionNdus || '').trim().replace(/^ndus=/i, '');

  if (sourceType === 'terabox_drive' && fsId) {
    if (!activeNdus) throw new Error('TeraBox account cookie is not active.');
    const origin = 'https://www.1024terabox.com';
    const cookieJar: Record<string, string> = { ndus: activeNdus, lang: 'en' };
    const mainRes = await fetch(`${origin}/main`, {
      headers: { 'User-Agent': BROWSER_UA, Cookie: serializeCookieJar(cookieJar) },
    });
    const jsToken = extractJsTokenFromHtml(await mainRes.text());

    const metaUrl = new URL(`${origin}/api/filemetas`);
    metaUrl.searchParams.set('app_id', '250528');
    metaUrl.searchParams.set('web', '1');
    metaUrl.searchParams.set('dlink', '1');
    metaUrl.searchParams.set('fsids', `[${fsId}]`);
    if (jsToken) metaUrl.searchParams.set('jsToken', jsToken);

    const metaRes = await fetch(metaUrl.toString(), {
      headers: buildBaseHeaders(cookieJar, `${origin}/main`),
    });
    const metaJson = (await metaRes.json().catch(() => ({}))) as Record<string, unknown>;
    const infoList = Array.isArray(metaJson.info) ? (metaJson.info as Record<string, unknown>[]) : [];
    const dlink = infoList[0]?.dlink ? String(infoList[0].dlink) : '';
    if (!dlink) throw new Error('Could not obtain a TeraBox streaming link for this file.');
    return {
      kind: 'mp4',
      streamUrl: dlink,
      headers: { 'User-Agent': BROWSER_UA, Cookie: serializeCookieJar(cookieJar), Referer: `${origin}/main` },
    };
  }

  if (shareUrl && fsId) {
    const activePasscode = passcode || cachedSessionPasscode;
    const session = await resolveShareSession(shareUrl, activePasscode, activeNdus);
    const targetItem = session.list.find((item) => String(item.fs_id) === String(fsId));
    if (targetItem?.dlink) {
      return {
        kind: 'mp4',
        streamUrl: String(targetItem.dlink),
        headers: buildBaseHeaders(session.cookieJar, session.shareUrl),
      };
    }

    if (session.shareid && session.uk && session.sign && session.timestamp) {
      const dlUrl = new URL(`${session.origin}/share/download`);
      dlUrl.searchParams.set('app_id', '250528');
      dlUrl.searchParams.set('web', '1');
      dlUrl.searchParams.set('channel', 'dubox');
      dlUrl.searchParams.set('clienttype', '0');
      dlUrl.searchParams.set('dp-logid', session.dpLogId);
      dlUrl.searchParams.set('sign', session.sign);
      dlUrl.searchParams.set('timestamp', session.timestamp);
      dlUrl.searchParams.set('shareid', session.shareid);
      dlUrl.searchParams.set('uk', session.uk);
      dlUrl.searchParams.set('primaryid', session.shareid);
      dlUrl.searchParams.set('fid_list', `[${fsId}]`);
      if (session.cookieJar.BDCLND) {
        dlUrl.searchParams.set('extra', JSON.stringify({ sekey: decodeURIComponent(session.cookieJar.BDCLND) }));
      }
      if (session.jsToken) dlUrl.searchParams.set('jsToken', session.jsToken);

      const dlRes = await fetch(dlUrl.toString(), {
        headers: buildBaseHeaders(session.cookieJar, session.shareUrl),
      });
      const dlJson = (await dlRes.json().catch(() => ({}))) as Record<string, unknown>;
      const list = Array.isArray(dlJson.list) ? (dlJson.list as Record<string, unknown>[]) : [];
      const dlink = dlJson.dlink ? String(dlJson.dlink) : list[0]?.dlink ? String(list[0].dlink) : '';
      if (dlink) {
        return { kind: 'mp4', streamUrl: dlink, headers: buildBaseHeaders(session.cookieJar, session.shareUrl) };
      }
    }

    const hlsPlaylist = await tryFetchGuestHlsPlaylist(session, fsId);
    if (hlsPlaylist) return { kind: 'hls', playlistText: hlsPlaylist };

    throw new Error('TeraBox blocked direct playback for this file. Please switch to Google Drive in Admin.');
  }

  throw new Error('Missing video source details to play this movie.');
}
