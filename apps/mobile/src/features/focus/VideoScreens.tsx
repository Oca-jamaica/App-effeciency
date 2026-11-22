import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Film, Trash2, Upload } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLive, useStore } from '@/data/DataProvider';
import type { Goal, StudyVideo, Task } from '@/data/types';
import { useGoalOptions } from '@/features/shared/options';
import {
  Button, Card, DateTimeField, EmptyState, ErrorState, Group, IconButton, ListRow, LoadingState, ProgressBar, Screen, SelectField, Sheet, Stepper, Text,
  TextField, confirm, formatDateLabel, radius, space, useToast,
} from '@/ui';
import { useTaskOptions } from './FocusScreen';
import { deleteVideo, playbackUrl, uploadVideo, type UploadHandle } from './videoStorage';
import { createVideoRecord, formatBytes, MAX_VIDEO_BYTES, validateVideo, type PickedVideo } from './videos';

/** Pick a timelapse, add details, upload with progress. Nothing is shared: videos are private to you. */
export function UploadSheet({
  onClose,
  today,
  focusSessionId,
  taskId: initialTask,
  goalId: initialGoal,
  sessionMinutes,
}: {
  onClose: () => void;
  today: string;
  focusSessionId?: string;
  taskId: string | null;
  goalId: string | null;
  sessionMinutes: number | null;
}) {
  const store = useStore();
  const toast = useToast();
  const taskOptions = useTaskOptions();
  const goalOptions = useGoalOptions();
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState(sessionMinutes ?? 60);
  const [taskId, setTaskId] = useState<string | null>(initialTask);
  const [goalId, setGoalId] = useState<string | null>(initialGoal);
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState<{ video: StudyVideo; message: string } | null>(null);
  const handle = useRef<UploadHandle | null>(null);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setProblem('ASCEND needs access to your videos to upload a timelapse. You can allow it in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: false, quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    const video: PickedVideo = { uri: a.uri, sizeBytes: a.fileSize ?? null, mimeType: a.mimeType ?? null, durationSeconds: a.duration ? a.duration / 1000 : null, fileName: a.fileName ?? null };
    setPicked(video);
    setProblem(validateVideo(video));
  };

  const start = async (existing?: StudyVideo) => {
    if (!picked) return;
    setFailed(null);
    setProgress(0);
    try {
      const video = existing ?? (await createVideoRecord(store, picked, { recordedOn: date, sessionMinutes: minutes, notes, focusSessionId: focusSessionId ?? null, taskId, goalId }));
      handle.current = uploadVideo(store, video, picked.uri, setProgress);
      await handle.current.promise;
      toast.show('Timelapse uploaded. Only you can see it.');
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const [latest] = await store.list<StudyVideo>('study_videos', { orderBy: 'created_at DESC', limit: 1 });
      if (latest) setFailed({ video: latest, message });
      setProgress(null);
    }
  };

  const uploading = progress !== null;
  return (
    <Sheet
      visible
      onClose={() => {
        if (uploading) return toast.show('The upload continues in the background. You can check it in Focus.', { kind: 'info' });
        onClose();
      }}
      title="Upload a timelapse"
      footer={
        uploading ? (
          <View style={{ gap: space.sm }}>
            <ProgressBar value={progress} height={6} />
            <Text variant="caption" tone="secondary">Uploading… {Math.round((progress ?? 0) * 100)}%{picked?.sizeBytes ? ` of ${formatBytes(picked.sizeBytes)}` : ''}</Text>
            <Button label="Cancel upload" variant="ghost" onPress={() => void handle.current?.cancel()} />
          </View>
        ) : failed ? (
          <View style={{ gap: space.sm }}>
            <Text variant="callout" tone="danger">{failed.message}</Text>
            <Button label="Try again" icon={Upload} onPress={() => void start(failed.video)} />
          </View>
        ) : (
          <Button label="Upload" icon={Upload} onPress={() => void start()} disabled={!picked || !!problem} />
        )
      }
    >
      <Card onPress={uploading ? undefined : () => void pick()} accessibilityLabel={picked ? 'Choose a different video' : 'Choose a video'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Film size={22} color="#888" />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{picked ? picked.fileName ?? 'Video selected' : 'Choose a video'}</Text>
            <Text variant="caption" tone="secondary">
              {picked ? [picked.sizeBytes ? formatBytes(picked.sizeBytes) : null, picked.durationSeconds ? `${Math.round(picked.durationSeconds)} s` : null].filter(Boolean).join(' · ') : `MP4 or MOV, up to ${formatBytes(MAX_VIDEO_BYTES)}`}
            </Text>
          </View>
        </View>
      </Card>
      {problem ? <Text variant="callout" tone="danger">{problem}</Text> : null}
      <DateTimeField label="Study date" mode="date" value={date} onChange={setDate} />
      <View style={{ gap: space.xs }}>
        <Text variant="captionStrong" tone="secondary">Session length</Text>
        <Stepper value={minutes} onChange={setMinutes} min={5} max={600} step={5} format={(v) => `${Math.floor(v / 60)}h ${v % 60}m`} />
      </View>
      <SelectField label="Study task" value={taskId} options={taskOptions} onChange={setTaskId} allowClear placeholder="None" />
      <SelectField label="Goal" value={goalId} options={goalOptions} onChange={setGoalId} allowClear placeholder="None" />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline minLines={2} placeholder="What you studied" />
      <Text variant="caption" tone="tertiary">Videos are stored privately in your account. They’re never shared or published.</Text>
    </Sheet>
  );
}

export function VideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const toast = useToast();
  const data = useLive(
    async (s) => {
      const v = await s.get<StudyVideo>('study_videos', id);
      if (!v || v.deleted_at) return null;
      const [task, goal] = await Promise.all([v.task_id ? s.get<Task>('tasks', v.task_id) : null, v.goal_id ? s.get<Goal>('goals', v.goal_id) : null]);
      return { v, task, goal };
    },
    [id],
    ['study_videos', 'tasks', 'goals'],
  );
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = data.data?.v;
  useEffect(() => {
    if (!video || video.upload_status !== 'ready') return;
    playbackUrl(video).then(setUrl).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [video?.id, video?.upload_status]);

  if (data.loading && !data.data) return <LoadingState />;
  if (!data.data || !video) return <EmptyState title="This video no longer exists" actionLabel="Back" onAction={() => router.back()} />;
  const { task, goal } = data.data;
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Timelapse',
          headerRight: () => (
            <IconButton
              icon={Trash2}
              label="Delete video"
              tone="danger"
              onPress={async () => {
                if (!(await confirm({ title: 'Delete this timelapse?', message: 'The video file is permanently removed from your storage.', confirmLabel: 'Delete', destructive: true }))) return;
                try {
                  await deleteVideo(store, video);
                  toast.show('Timelapse deleted');
                  router.back();
                } catch (e) {
                  toast.show(e instanceof Error ? e.message : String(e), { kind: 'error' });
                }
              }}
            />
          ),
        }}
      />
      <Screen edges="none">
        {video.upload_status !== 'ready' ? (
          <Card>
            <Text variant="body">{video.upload_status === 'failed' ? `This upload didn’t finish: ${video.upload_error ?? 'unknown error'}. Delete it and upload again.` : 'This video is still uploading.'}</Text>
          </Card>
        ) : error ? (
          <ErrorState message={error} onRetry={() => { setError(null); playbackUrl(video).then(setUrl).catch((e) => setError(String(e))); }} />
        ) : url ? (
          <Player url={url} />
        ) : (
          <LoadingState label="Loading video" />
        )}
        <Group>
          <ListRow title="Study date" trailing={<Text variant="callout" tone="secondary">{formatDateLabel(video.recorded_on)}</Text>} />
          {video.session_minutes ? <ListRow title="Session" trailing={<Text variant="callout" tone="secondary">{Math.floor(video.session_minutes / 60)}h {video.session_minutes % 60}m</Text>} /> : null}
          <ListRow title="Size" trailing={<Text variant="callout" tone="secondary">{formatBytes(video.size_bytes)}</Text>} />
          {task ? <ListRow title="Task" subtitle={task.title} chevron onPress={() => router.push({ pathname: '/(app)/task/[id]', params: { id: task.id } })} /> : null}
          {goal ? <ListRow title="Goal" subtitle={goal.title} chevron onPress={() => router.push({ pathname: '/(app)/goal/[id]', params: { id: goal.id } })} /> : null}
        </Group>
        {video.notes ? <Text variant="body" tone="secondary">{video.notes}</Text> : null}
        <Text variant="caption" tone="tertiary">Private to you. Playback links expire after an hour.</Text>
      </Screen>
    </>
  );
}

function Player({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" allowsPictureInPicture />;
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 9 / 16, maxHeight: 520, borderRadius: radius.lg, backgroundColor: '#000', alignSelf: 'center' },
});
