import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface SummaryItem {
  child_id: string;
  reference_number: string;
  first_name_fr: string;
  last_name_fr: string;
  room_id: string | null;
  status: 'expected' | 'present' | 'departed' | 'absent';
  check_in_at: string | null;
  check_out_at: string | null;
}

interface RoomOption {
  id: string;
  name_fr: string;
}

const STATUS_LABEL: Record<SummaryItem['status'], string> = {
  expected: 'att.expectedState',
  present: 'att.presentState',
  departed: 'att.departedState',
  absent: 'att.absentState',
};

export function AttendancePage(): React.JSX.Element {
  const { t } = useI18n();
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [roomId, setRoomId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<SummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyChild, setBusyChild] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<SummaryItem | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const loadRooms = (): void => {
    http
      .get<{ items: RoomOption[] }>('/rooms')
      .then((r) => setRooms(r.items))
      .catch(() => undefined);
  };
  useEffect(loadRooms, []);

  const load = (): void => {
    const q = new URLSearchParams();
    if (roomId) q.set('room_id', roomId);
    if (date) q.set('date', date);
    http
      .get<{ date: string; items: SummaryItem[] }>(`/attendance/summary?${q.toString()}`)
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((e: unknown) => setError(e.messageFr ?? ""));
  };
  useEffect(load, [roomId, date]);

  const act = async (action: 'check-in' | 'check-out' | 'mark-absent', childId: string, labelKey: string): Promise<void> => {
    setBusyChild(childId);
    setMessage(null);
    try {
      await http.post(`/attendance/${action}`, { child_id: childId });
      setMessage(t(labelKey));
      load();
    } catch (e: unknown) {
      setError(e.messageFr);
    } finally {
      setBusyChild(null);
    }
  };

  const submitCorrection = async (): Promise<void> => {
    if (!correcting || !reason.trim()) return;
    setBusyChild(correcting.child_id);
    setMessage(null);
    try {
      await http.post('/attendance/correct', { child_id: correcting.child_id, action: 'correct', reason: reason.trim() });
      setMessage(t('att.corrected'));
      setCorrecting(null);
      setReason('');
      load();
    } catch (e: unknown) {
      setError(e.messageFr);
    } finally {
      setBusyChild(null);
    }
  };

  const statusColor = (s: SummaryItem['status']): string => {
    switch (s) {
      case 'present': return '#16A34A';
      case 'departed': return '#3B82F6';
      case 'absent': return '#EF4444';
      default: return '#F59E0B';
    }
  };

  const time = (v: string | null): string => (v ? new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('att.title')}>
        <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <TextField label={t('common.room')} value={roomId} onChange={(v) => setRoomId(v)} placeholder={t('att.roomPlaceholder')} />
          </div>
          <div style={{ minWidth: 180 }}>
            <TextField label={t('common.date')} type="date" value={date} onChange={setDate} />
          </div>
          <Button variant="ghost" onClick={load}>{t('common.refresh')}</Button>
        </div>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {message && <p style={{ color: '#16A34A' }}>{message}</p>}
        <Table
          headers={[t('children.ref'), t('common.child'), t('common.room'), t('common.status'), 'Arrivée', 'Départ', t('common.actions')]}
          rows={items.map((item) => [
            item.reference_number,
            `${item.first_name_fr} ${item.last_name_fr}`,
            rooms.find((r) => r.id === item.room_id)?.name_fr ?? '—',
            <span key="s" style={{ color: statusColor(item.status), fontWeight: 600 }}>{t(STATUS_LABEL[item.status] ?? 'att.expectedState')}</span>,
            time(item.check_in_at),
            time(item.check_out_at),
            <div key="a" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button variant="primary" disabled={busyChild === item.child_id || item.status === 'present' || item.status === 'departed'} onClick={() => void act('check-in', item.child_id, 'att.checkedIn')}>{t('att.checkIn')}</Button>
              <Button variant="ghost" disabled={busyChild === item.child_id || item.status === 'expected' || item.status === 'absent' || item.status === 'departed'} onClick={() => void act('check-out', item.child_id, 'att.checkedOut')}>{t('att.checkOut')}</Button>
              <Button variant="danger" disabled={busyChild === item.child_id || item.status !== 'expected'} onClick={() => void act('mark-absent', item.child_id, 'att.markedAbsent')}>{t('att.absent')}</Button>
              <Button variant="ghost" disabled={busyChild === item.child_id} onClick={() => setCorrecting(item)}>{t('att.correct')}</Button>
            </div>,
          ])}
        />
      </Card>

      {correcting && (
        <Card title={`${t('att.correct')} — ${correcting.first_name_fr} ${correcting.last_name_fr}`}>
          <TextField label={t('att.reason')} value={reason} onChange={setReason} required />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => void submitCorrection()} disabled={!reason.trim()}>{t('common.confirm')}</Button>
            <Button variant="ghost" onClick={() => { setCorrecting(null); setReason(''); }}>{t('common.cancel')}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
