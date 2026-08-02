import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface Conversation {
  id: string;
  child_id: string | null;
  subject: string | null;
  is_archived: boolean;
  last_message_at: string | null;
  created_at: string;
  child_first_name: string | null;
  child_last_name: string | null;
  message_count: number;
}

interface Message {
  id: string;
  sender_id: string;
  body: string;
  is_system_message: boolean;
  sent_at: string;
}

interface ConversationDetail extends Conversation {
  participants: Array<{ user_id: string; first_name: string; last_name: string; email: string | null }>;
  messages: Message[];
}

export function MessagingPage(): React.JSX.Element {
  const { t } = useI18n();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Création
  const [childId, setChildId] = useState('');
  const [subject, setSubject] = useState('');
  // Envoi
  const [draft, setDraft] = useState('');
  const [meId, setMeId] = useState<string | null>(null);

  const load = (): void => {
    http
      .get<Conversation[]>('/messaging/conversations')
      .then((r) => {
        setConversations(r);
        setError(null);
      })
      .catch((e: any) => setError(e.messageFr ?? ''));
  };
  useEffect(load, []);

  const open = async (id: string): Promise<void> => {
    setError(null);
    try {
      const detail = await http.get<ConversationDetail>(`/messaging/conversations/${id}`);
      setSelected(detail);
      if (!meId) {
        const me = await http.get<{ id: string }>('/me');
        setMeId(me.id);
      }
    } catch (e: any) {
      setError(e.messageFr ?? '');
    }
  };

  const create = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const conv = await http.post<{ id: string }>('/messaging/conversations', {
        child_id: childId || undefined,
        subject: subject || undefined,
      });
      setMessage(t('msg.created'));
      setChildId('');
      setSubject('');
      load();
      await open(conv.id);
    } catch (e: any) {
      setError(e.messageFr ?? '');
    }
  };

  const send = async (): Promise<void> => {
    if (!selected || !draft.trim()) return;
    setError(null);
    try {
      await http.post(`/messaging/conversations/${selected.id}/messages`, { body: draft.trim() });
      setDraft('');
      await open(selected.id);
    } catch (e: any) {
      setError(e.messageFr ?? '');
    }
  };

  const fmt = (v: string | null): string => (v ? new Date(v).toLocaleString('fr-FR') : '—');
  const mine = (m: Message): boolean => meId != null && m.sender_id === meId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('msg.title')}>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {message && <p style={{ color: '#16A34A' }}>{message}</p>}

        <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: tokens.spacing.md }}>
          <div style={{ minWidth: 240 }}>
            <TextField label={t('common.child') + ' (UUID, optionnel)'} value={childId} onChange={setChildId} dir="ltr" />
          </div>
          <div style={{ minWidth: 220 }}>
            <TextField label={t('msg.subject')} value={subject} onChange={setSubject} />
          </div>
          <Button onClick={() => void create()} disabled={!childId && !subject}>{t('msg.create')}</Button>
        </div>

        <Table
          headers={[t('common.child'), t('msg.subject'), t('msg.messages'), t('common.date')]}
          rows={conversations.map((c) => [
            c.child_first_name ? `${c.child_first_name} ${c.child_last_name ?? ''}`.trim() : '—',
            c.subject ?? '—',
            <span key="n">{c.message_count}</span>,
            fmt(c.last_message_at ?? c.created_at),
          ])}
          onRowClick={(i) => void open(conversations[i].id)}
        />
        {conversations.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
      </Card>

      {selected && (
        <Card title={`${t('msg.conversation')} — ${selected.child_first_name ?? ''} ${selected.child_last_name ?? ''}`.trim()}>
          <div style={{ fontSize: 13, color: tokens.colors.textMuted, marginBottom: tokens.spacing.md }}>
            {t('msg.participants')} : {selected.participants.map((p) => `${p.first_name} ${p.last_name}`).join(', ')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', marginBottom: tokens.spacing.md }}>
            {selected.messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: mine(m) ? 'flex-end' : 'flex-start',
                  background: mine(m) ? tokens.colors.primary : '#F1F5F9',
                  color: mine(m) ? '#fff' : '#0F172A',
                  borderRadius: 10,
                  padding: '8px 12px',
                  maxWidth: '75%',
                  fontSize: 14,
                }}
              >
                <div>{m.body}</div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{fmt(m.sent_at)}</div>
              </div>
            ))}
            {selected.messages.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <TextField value={draft} onChange={setDraft} placeholder={t('msg.placeholder')} />
            </div>
            <Button onClick={() => void send()} disabled={!draft.trim()}>{t('msg.send')}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
