import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface Camera {
  id: string;
  name: string;
  zone: string;
  is_active: boolean;
  clips_count: number;
  created_at: string;
}

interface Clip {
  id: string;
  camera_id: string;
  camera_name: string;
  captured_at: string;
  storage_backend: 'local' | 's3';
  mime_type: string;
  size_bytes: number | null;
  duration_seconds: number | null;
  purge_at: string;
}

const ZONES = ['entrance', 'corridor', 'common_room', 'playground'] as const;

/**
 * Vidéosurveillance (post-DPIA, loi 25-11) — direction uniquement.
 * Jamais de flux en direct : seuls des extraits exportés du DVR/NVR local.
 * Purge automatique à 30 jours ; tout visionnage est journalisé.
 */
export function VideoPage(): React.JSX.Element {
  const { t } = useI18n();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [zone, setZone] = useState<string>(ZONES[0]);
  const [filter, setFilter] = useState('');

  const handleError = (e: any): void => {
    if (e?.code === 'VIDEO_FEATURE_DISABLED') setDisabled(true);
    setError(e?.messageFr ?? String(e));
  };

  const load = (): void => {
    http.get<Camera[]>('/video/cameras')
      .then((c) => { setCameras(c); setDisabled(false); setError(null); })
      .catch(handleError);
    http.get<Clip[]>('/video/clips')
      .then((c) => setClips(c))
      .catch(() => setClips([]));
  };
  useEffect(load, []);

  const createCamera = (): void => {
    setMessage(null);
    http.post<Camera>('/video/cameras', { name: name.trim(), zone })
      .then(() => { setName(''); setMessage(t('video.cameraCreated')); load(); })
      .catch(handleError);
  };

  const toggleCamera = (cam: Camera): void => {
    http.patch(`/video/cameras/${cam.id}`, { is_active: !cam.is_active })
      .then(load)
      .catch(handleError);
  };

  const viewClip = (clip: Clip): void => {
    http.get<{ storage_backend: string; download_url?: string; content_url?: string }>(`/video/clips/${clip.id}/download`)
      .then((r) => {
        if (r.content_url) window.open(r.content_url, '_blank');
        else if (r.download_url) window.open(r.download_url, '_blank');
      })
      .catch(handleError);
  };

  const visibleClips = filter ? clips.filter((c) => c.camera_id === filter) : clips;

  if (disabled) {
    return (
      <div style={{ padding: tokens.spacing.lg }}>
        <Card title={t('video.title')}>
          <p style={{ color: tokens.colors.textMuted }}>{t('video.disabled')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: tokens.spacing.lg, display: 'grid', gap: tokens.spacing.lg }}>
      <h1 style={{ margin: 0 }}>{t('video.title')}</h1>
      {error ? <p style={{ color: tokens.colors.danger }}>{error}</p> : null}
      {message ? <p style={{ color: tokens.colors.success }}>{message}</p> : null}

      <Card title={t('video.cameras')}>
        <div style={{ display: 'flex', gap: tokens.spacing.sm, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: tokens.spacing.md }}>
          <TextField label={t('video.cameraName')} value={name} onChange={setName} placeholder={t('video.cameraNamePlaceholder')} />
          <label style={{ display: 'grid', gap: 4, fontSize: tokens.typography.small }}>
            {t('video.zone')}
            <select value={zone} onChange={(e) => setZone(e.target.value)} style={{ padding: '8px 10px', minWidth: 180 }}>
              {ZONES.map((z) => <option key={z} value={z}>{t(`video.zone.${z}`)}</option>)}
            </select>
          </label>
          <Button onClick={createCamera} disabled={name.trim().length < 2}>{t('video.addCamera')}</Button>
        </div>
        <Table
          headers={[t('video.cameraName'), t('video.zone'), t('video.status'), t('video.clips'), t('common.actions')]}
          rows={cameras.map((c) => [
            c.name,
            t(`video.zone.${c.zone}`),
            c.is_active ? t('video.active') : t('video.inactive'),
            String(c.clips_count),
            <Button key={c.id} variant="ghost" onClick={() => toggleCamera(c)}>{c.is_active ? t('video.deactivate') : t('video.activate')}</Button>,
          ])}
        />
        <p style={{ color: tokens.colors.textMuted, fontSize: tokens.typography.small }}>{t('video.noLiveNote')}</p>
      </Card>

      <Card title={t('video.clipsTitle')}>
        <label style={{ display: 'grid', gap: 4, fontSize: tokens.typography.small, maxWidth: 320, marginBottom: tokens.spacing.md }}>
          {t('video.filterCamera')}
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: '8px 10px' }}>
            <option value="">{t('video.allCameras')}</option>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <Table
          headers={[t('video.cameraName'), t('video.capturedAt'), t('video.size'), t('video.purgeAt'), t('common.actions')]}
          rows={visibleClips.map((c) => [
            c.camera_name,
            new Date(c.captured_at).toLocaleString(),
            c.size_bytes ? `${Math.round(c.size_bytes / 1024 / 102.4) / 10} Mo` : '—',
            new Date(c.purge_at).toLocaleDateString(),
            <Button key={c.id} variant="ghost" onClick={() => void viewClip(c)}>{t('video.view')}</Button>,
          ])}
        />
        <p style={{ color: tokens.colors.textMuted, fontSize: tokens.typography.small }}>{t('video.purgeNote')}</p>
      </Card>
    </div>
  );
}
