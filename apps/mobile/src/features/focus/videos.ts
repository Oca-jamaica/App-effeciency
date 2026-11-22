/**
 * Study timelapse videos: private storage, owner-only access. The row (metadata) syncs like any other
 * record; the file goes to the private `study-videos` bucket under the owner's folder.
 */
import type { Store } from '../../data/store.ts';
import type { StudyVideo } from '../../data/types.ts';

export const VIDEO_BUCKET = 'study-videos';
/** Matches the bucket's limit. Supabase's Free plan caps uploads at 50 MB regardless. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;
export type VideoMime = (typeof ALLOWED_VIDEO_TYPES)[number];

export interface PickedVideo {
  uri: string;
  sizeBytes: number | null;
  mimeType: string | null;
  durationSeconds: number | null;
  fileName: string | null;
}

/** Works out a supported MIME type from what the picker reports, or from the file name. */
export function resolveMime(v: Pick<PickedVideo, 'mimeType' | 'fileName' | 'uri'>): VideoMime | null {
  const m = v.mimeType?.toLowerCase();
  if (m === 'video/mp4' || m === 'video/quicktime') return m;
  const name = (v.fileName ?? v.uri).toLowerCase();
  if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
  if (name.endsWith('.mov')) return 'video/quicktime';
  return null;
}

/** A plain-language reason the video can't be uploaded, or null when it's fine. */
export function validateVideo(v: PickedVideo, maxBytes = MAX_VIDEO_BYTES): string | null {
  if (!resolveMime(v)) return 'Only MP4 and MOV videos can be uploaded.';
  if (v.sizeBytes === null) return 'This video’s size couldn’t be read. Try saving it to your library first.';
  if (v.sizeBytes <= 0) return 'This video appears to be empty.';
  if (v.sizeBytes > maxBytes) {
    return `This video is ${(v.sizeBytes / 1024 / 1024).toFixed(0)} MB; the limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB. Export it at a lower resolution and try again.`;
  }
  return null;
}

export function storagePathFor(userId: string, videoId: string, mime: VideoMime): string {
  return `${userId}/${videoId}.${mime === 'video/mp4' ? 'mp4' : 'mov'}`;
}

/** Creates the video's record before uploading, so a failed or interrupted upload can be retried. */
export async function createVideoRecord(
  store: Store,
  video: PickedVideo,
  details: { recordedOn: string; sessionMinutes: number | null; notes: string | null; focusSessionId?: string | null; taskId?: string | null; goalId?: string | null },
): Promise<StudyVideo> {
  const problem = validateVideo(video);
  if (problem) throw new Error(problem);
  const mime = resolveMime(video)!;
  const id = store.newId();
  return store.insert<StudyVideo>('study_videos', {
    id,
    focus_session_id: details.focusSessionId ?? null,
    task_id: details.taskId ?? null,
    goal_id: details.goalId ?? null,
    recorded_on: details.recordedOn,
    storage_path: storagePathFor(store.userId, id, mime),
    mime_type: mime,
    size_bytes: video.sizeBytes!,
    duration_seconds: video.durationSeconds !== null ? Math.round(video.durationSeconds) : null,
    session_minutes: details.sessionMinutes,
    notes: details.notes?.trim() || null,
    upload_status: 'uploading',
  });
}

export async function markUploaded(store: Store, id: string): Promise<void> {
  await store.update('study_videos', id, { upload_status: 'ready', upload_error: null });
}

export async function markUploadFailed(store: Store, id: string, message: string): Promise<void> {
  await store.update('study_videos', id, { upload_status: 'failed', upload_error: message.slice(0, 500) });
}

export async function listVideos(store: Store, opts: { goalId?: string; taskId?: string } = {}): Promise<StudyVideo[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.goalId) (where.push('goal_id = ?'), params.push(opts.goalId));
  if (opts.taskId) (where.push('task_id = ?'), params.push(opts.taskId));
  return store.list<StudyVideo>('study_videos', { where: where.join(' AND ') || undefined, params, orderBy: 'recorded_on DESC, created_at DESC' });
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
