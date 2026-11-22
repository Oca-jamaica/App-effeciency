/** Device side of timelapse storage: background-capable upload with progress, playback URLs and deletion. */
import * as LegacyFS from 'expo-file-system/legacy';
import { requireSupabase } from '@/services/supabase';
import type { Store } from '@/data/store';
import type { StudyVideo } from '@/data/types';
import { VIDEO_BUCKET, markUploadFailed, markUploaded } from './videos';

export interface UploadHandle {
  promise: Promise<void>;
  cancel: () => Promise<void>;
}

/**
 * Uploads the file to the owner's private folder using a one-time signed URL. Uses a background
 * session where the platform supports it, so switching apps doesn't kill the upload.
 */
export function uploadVideo(store: Store, video: StudyVideo, fileUri: string, onProgress: (fraction: number) => void): UploadHandle {
  let task: LegacyFS.UploadTask | null = null;
  let cancelled = false;
  const promise = (async () => {
    try {
      const client = requireSupabase();
      const { data, error } = await client.storage.from(VIDEO_BUCKET).createSignedUploadUrl(video.storage_path, { upsert: true });
      if (error || !data) throw new Error(error?.message ?? 'Could not start the upload');
      task = LegacyFS.createUploadTask(
        data.signedUrl,
        fileUri,
        {
          httpMethod: 'PUT',
          uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
          sessionType: LegacyFS.FileSystemSessionType.BACKGROUND,
          headers: { 'content-type': video.mime_type, 'x-upsert': 'true' },
        },
        (p) => {
          if (p.totalBytesExpectedToSend > 0) onProgress(p.totalBytesSent / p.totalBytesExpectedToSend);
        },
      );
      const result = await task.uploadAsync();
      if (cancelled) throw new Error('Upload cancelled');
      if (!result || result.status < 200 || result.status >= 300) {
        const detail = result?.body ? safeMessage(result.body) : `status ${result?.status ?? 'unknown'}`;
        throw new Error(result?.status === 413 ? 'The file is larger than your storage plan allows.' : `Upload failed (${detail})`);
      }
      onProgress(1);
      await markUploaded(store, video.id);
    } catch (e) {
      await markUploadFailed(store, video.id, e instanceof Error ? e.message : String(e));
      throw e;
    }
  })();
  return {
    promise,
    cancel: async () => {
      cancelled = true;
      await task?.cancelAsync().catch(() => undefined);
    },
  };
}

function safeMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { message?: string; error?: string };
    return j.message ?? j.error ?? body.slice(0, 120);
  } catch {
    return body.slice(0, 120);
  }
}

/** A playback URL that expires after an hour; only the owner can create one. */
export async function playbackUrl(video: StudyVideo): Promise<string> {
  const { data, error } = await requireSupabase().storage.from(VIDEO_BUCKET).createSignedUrl(video.storage_path, 3600);
  if (error || !data) throw new Error(error?.message ?? 'This video isn’t available yet');
  return data.signedUrl;
}

/** Deletes the stored file, then the record. The record is kept if the file couldn't be removed. */
export async function deleteVideo(store: Store, video: StudyVideo): Promise<void> {
  if (video.upload_status === 'ready' || video.upload_status === 'uploading' || video.upload_status === 'failed') {
    const { error } = await requireSupabase().storage.from(VIDEO_BUCKET).remove([video.storage_path]);
    if (error && !/not.?found/i.test(error.message)) throw new Error(`Couldn’t delete the video file: ${error.message}`);
  }
  await store.remove('study_videos', video.id);
}
