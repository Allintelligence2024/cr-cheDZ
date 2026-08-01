import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface JournalEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  meal_type: string | null;
  nap_start_at: string | null;
  nap_end_at: string | null;
  diaper_type: string | null;
  activity_name: string | null;
  temperature_celsius: string | null;
  note_text: string | null;
  note_is_private: boolean | null;
  incident_severity: string | null;
  incident_description: string | null;
  is_correction: boolean;
  correction_reason: string | null;
  visible_to_parents: boolean;
}

export function JournalPage(): React.JSX.Element {
  const { t } = useI18n();
  const [childId, setChildId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<JournalEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = (): void => {
    if (!childId) {
      setItems([]);
      return;
    }
    const q = new URLSearchParams({ child_id: childId, date });
    http
      .get<{ items: JournalEvent[] }>(`/journal/events?${q.toString()}`)
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e: any) => setError(e.messageFr ?? ''));
  };
  useEffect(load, [childId, date]);

  const toggle = async (event: JournalEvent): Promise<void> => {
    setMessage(null);
    setError(null);
    try {
      await http.patch(`/journal/events/${event.id}/visibility`, { visible_to_parents: !event.visible_to_parents });
      load();
    } catch (e: any) {
      setError(e.messageFr ?? t('journal.toggleError'));
    }
  };

  const label = (e: JournalEvent): string => {
    switch (e.event_type) {
      case 'meal': return `🍽 ${e.meal_type ?? ''}`;
      case 'nap_start': return `😴 ${t('napStart')}`;
      case 'nap_end': return `😴 ${t('napEnd')}`;
      case 'diaper': return `🧷 ${e.diaper_type ?? ''}`;
      case 'activity': return `🎨 ${e.activity_name ?? ''}`;
      case 'temperature': return `🌡 ${e.temperature_celsius ?? ''} °C`;
      case 'note': return `📝 ${e.note_text ?? ''}`;
      case 'incident': return `⚠️ ${e.incident_description ?? ''} (${e.incident_severity ?? ''})`;
      default: return e.event_type;
    }
  };

  const fmt = (v: string | null): string => (v ? new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('journal.title')}>
        <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 260 }}>
            <TextField label={t('common.child') + ' (UUID)'} value={childId} onChange={setChildId} dir="ltr" />
          </div>
          <div style={{ minWidth: 180 }}>
            <TextField label={t('common.date')} type="date" value={date} onChange={setDate} />
          </div>
          <Button variant="ghost" onClick={load}>{t('common.refresh')}</Button>
        </div>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {message && <p style={{ color: '#16A34A' }}>{message}</p>}
        <Table
          headers={['Heure', 'Événement', t('journal.visibility'), t('common.actions')]}
          rows={items.map((item) => [
            fmt(item.occurred_at),
            <span key="l">
              {label(item)}
              {item.note_is_private && <em style={{ color: tokens.colors.textMuted }}> — {t('journal.privateNote')}</em>}
              {item.is_correction && <em style={{ color: '#F59E0B' }}> — {t('journal.correction')}{item.correction_reason ? ` : ${item.correction_reason}` : ''}</em>}
            </span>,
            <span key="v" style={{ color: item.visible_to_parents ? '#16A34A' : tokens.colors.textMuted }}>
              {item.visible_to_parents ? t('journal.visible') : t('journal.hidden')}
            </span>,
            <Button key="b" variant="ghost" disabled={Boolean(item.note_is_private)} onClick={() => void toggle(item)}>
              {item.visible_to_parents ? t('journal.hide') : t('journal.show')}
            </Button>,
          ])}
        />
      </Card>
    </div>
  );
}
