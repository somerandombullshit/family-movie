export type MovieSourceType =
  | 'gdrive_file'
  | 'terabox_share'
  | 'terabox_drive'
  | 'direct_url';

export interface MovieItem {
  id: string;
  title: string;
  fileName: string;
  sourceType: MovieSourceType;
  driveFileId?: string;
  shareUrl?: string;
  fsId?: string;
  uk?: string;
  shareId?: string;
  directUrl?: string;
  thumbnailUrl?: string;
  sizeBytes?: number;
  durationLabel?: string;
  hidden: boolean;
  addedByUid: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface LibrarySettings {
  connectionMode: 'gdrive_folder' | 'share_folder' | 'drive_cookie' | 'manual';
  shareUrl?: string;
  folderPath?: string;
  updatedByUid: string;
}

export interface AdminSecret {
  ndusCookie?: string;
  passcode?: string;
  folderPath?: string;
  updatedByUid: string;
}

export interface SyncedMoviePayload {
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
