import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface MediaItem {
  id: string;
  child_id: string | null;
  media_type: string;
  original_filename: string | null;
  mime_type: string;
  file_size_bytes: number | null;
  taken_at: string | null;
  is_visible_to_parents: boolean;
  all_consents_checked: boolean;
  created_at: string;
}

export function MediaPage(): React.JSX.Element {
  const { t } = useI18n();
  const [childId, setChildId] = useState('');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = (): void => {
    const q = childId ? `?child_id=${encodeURIComponent(childId)}` : '';
    http
      .get<{ items: MediaItem[] }>(`/media${q}`)
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e: unknown) => setError(e.messageFr ?? ''));
  };
  useEffect(load, [childId]);

  const setVisibility = async (id: string, visible: boolean): Promise<void> => {
    setBusy(id);
    setMessage(null);
    setError(null);
    try {
      await http.patch(`/media/${id}/visibility`, { is_visible_to_parents: visible });
      load();
    } catch (e: unknown) {
      setError(e.messageFr ?? (visible ? t('media.consentRequired') : t('common.error')));
    } finally {
      setBusy(null);
    }
  };

  const download = async (id: string): Promise<void> => {
    setError(null);
    try {
      const { url } = await http.get<{ url: string; key: string }>(`/media/${id}/download`);
      window.open(url, '_blank', 'noopener');
    } catch (e: unknown) {
      setError(e.messageFr ?? '');
    }
  };

  const size = (b: number | null): string => {
    if (b == null) return '—';
    return b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} Mo` : `${Math.round(b / 1024)} Ko`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('media.title')}>
        <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 260 }}>
            <TextField label={t('common.child') + ' (UUID, optionnel)'} value={childId} onChange={setChildId} dir="ltr" />
          </div>
          <Button variant="ghost" onClick={load}>{t('common.refresh')}</Button>
        </div>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {message && <p style={{ color: '#16A34A' }}>{message}</p>}
        {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('media.noMedia')}</p>}
        <Table
          headers={['Fichier', 'Type', 'Taille', t('media.visible'), t('common.actions')]}
          rows={items.map((item) => [
            item.original_filename ?? item.id.slice(0, 8),
            item.media_type,
            size(item.file_size_bytes),
            <span key="v" style={{ color: item.is_visible_to_parents ? '#16A34A' : tokens.colors.textMuted }}>
              {item.is_visible_to_parents ? t('media.visible') : t('media.pending')}
            </span>,
            <div key="a" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {!item.is_visible_to_parents ? (
                <Button disabled={busy === item.id} onClick={() => void setVisibility(item.id, true)}>{t('media.approve')}</Button>
              ) : (
                <Button variant="ghost" disabled={busy === item.id} onClick={() => void setVisibility(item.id, false)}>{t('media.hide')}</Button>
              )}
              <Button variant="ghost" disabled={busy === item.id} onClick={() => void download(item.id)}>{t('media.download')}</Button>
            </div>,
          ])}
        />
      </Card>
    </div>
  );
}
