import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { ApiError, http } from '../api/client';
import { useI18n } from '../i18n';

interface Child {
  id: string;
  reference_number: string;
  first_name_fr: string;
  last_name_fr: string;
  date_of_birth: string;
  gender: string | null;
  room_id: string | null;
  status: string;
  version: number;
}

interface RoomMove {
  room_id_from: string | null;
  room_id_to: string | null;
  room_from: string | null;
  room_to: string | null;
  moved_at: string;
  reason: string | null;
}

interface StatusChange {
  status_from: string | null;
  status_to: string;
  changed_at: string;
  reason: string | null;
}

interface ChildFiche extends Child {
  room_name: string | null;
  site_name: string | null;
  room_moves: RoomMove[];
  status_history: StatusChange[];
}

/** Petit parseur CSV (RFC 4180) pour l'import sans dépendance. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

interface ImportError {
  row: number;
  field: string;
  message_fr: string;
  message_ar: string;
}

const HEADERS = [
  'first_name_fr',
  'last_name_fr',
  'date_of_birth',
  'gender',
  'guardian_first_name',
  'guardian_last_name',
  'guardian_phone',
  'guardian_relationship',
  'notes',
];

export function ChildrenPage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Child[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportError[] | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fiche, setFiche] = useState<ChildFiche | null>(null);
  const [ficheError, setFicheError] = useState<string | null>(null);

  const openFiche = async (id: string): Promise<void> => {
    setFicheError(null);
    try {
      const detail = await http.get<ChildFiche>(`/children/${id}`);
      setFiche(detail);
    } catch (e: unknown) {
      setFicheError(e instanceof ApiError ? e.messageFr ?? t('common.error') : t('common.error'));
    }
  };

  const load = (): void => {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    http
      .get<{ items: Child[]; total: number }>(`/children${q}`)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.messageFr));
  };
  useEffect(load, [search]);

  const onFile = async (file: File): Promise<void> => {
    setError(null);
    setReport(null);
    setImported(null);
    setBusy(true);
    try {
      let rows: Array<Record<string, string>> = [];
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      if (isCsv) {
        const text = await file.text();
        const parsed = parseCsv(text);
        const headerIdx = parsed[0].map((h) => h.trim().toLowerCase());
        rows = parsed.slice(1).map((cells) => {
          const obj: Record<string, string> = {};
          headerIdx.forEach((h, i) => {
            if (HEADERS.includes(h)) obj[h] = (cells[i] ?? '').trim();
          });
          return obj;
        });
      } else {
        // XLSX : parsing côté client via exceljs (import dynamique — le paquet
        // xlsx est retiré : vulnérabilité prototype pollution sans correctif).
        const ExcelJS = await import('exceljs');
        const data = await file.arrayBuffer();
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(data);
        const sheet = wb.worksheets[0];
        if (!sheet) throw new Error('Fichier Excel vide');
        const headerRow = sheet.getRow(1);
        const headers = new Map<number, string>();
        headerRow.eachCell((cell, col) => {
          const name = String(cell.text ?? '').trim().toLowerCase();
          if (name) headers.set(col, name);
        });
        rows = [];
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const obj: Record<string, string> = {};
          headers.forEach((name, col) => {
            const cell = row.getCell(col);
            const raw = cell.value;
            let value = '';
            if (raw !== null && raw !== undefined) {
              value = typeof raw === 'object' && 'text' in raw ? String((raw as { text: unknown }).text) : String(raw);
            }
            if (HEADERS.includes(name)) obj[name] = value.trim();
          });
          if (Object.keys(obj).length > 0) rows.push(obj);
        });
      }

      // Dry-run d'abord, puis commit si aucune erreur bloquante.
      const dry = await http.post<{ inserted: number; errors: ImportError[] }>('/children/import', {
        dry_run: true,
        rows,
      });
      if (dry.errors.length > 0) {
        setReport(dry.errors);
        setImported(null);
        return;
      }
      const res = await http.post<{ inserted: number; errors: ImportError[] }>('/children/import', {
        dry_run: false,
        rows,
      });
      setReport(res.errors);
      setImported(res.inserted);
      load();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.messageFr : 'Erreur lors de l\'import');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`${t('children.title')} (${total})`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <TextField label={t('common.search')} value={search} onChange={setSearch} />
        <label style={{ fontSize: tokens.typography.small, color: tokens.colors.textMuted }}>
          {t('children.import')}
          <input
            type="file"
            accept=".csv,.xlsx"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
            style={{ display: 'block', marginTop: 4 }}
          />
        </label>
      </div>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {imported !== null && (
        <p style={{ color: tokens.colors.success, fontSize: tokens.typography.small }}>
          {`${t('children.imported')} : ${imported}`}
        </p>
      )}
      {report && report.length > 0 && (
        <div style={{ background: '#FEF2F2', border: `1px solid ${tokens.colors.danger}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <strong>{t('children.importErrors')}</strong>
          <ul style={{ fontSize: tokens.typography.small, marginBottom: 0 }}>
            {report.map((r, i) => (
              <li key={i}>
                {t('children.row')} {r.row} — {r.field} : {r.message_fr}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Table
        headers={[t('children.ref'), t('common.name'), t('children.birth'), 'Genre', t('room.title'), t('invitation.status'), t('common.actions')]}
        rows={items.map((c) => [
          c.reference_number,
          `${c.first_name_fr} ${c.last_name_fr}`,
          c.date_of_birth.slice(0, 10),
          c.gender ?? '—',
          c.room_id ? c.room_id.slice(0, 8) : '—',
          c.status,
          <Button key="d" variant="ghost" onClick={() => void openFiche(c.id)}>{t('child.detail')}</Button>,
        ])}
      />
      {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}

      {fiche && (
        <div style={{ marginTop: tokens.spacing.lg, border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.md, padding: tokens.spacing.lg }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{t('child.detail')} — {fiche.first_name_fr} {fiche.last_name_fr}</h3>
            <Button variant="ghost" onClick={() => setFiche(null)}>{t('common.close')}</Button>
          </div>
          {ficheError && <p style={{ color: tokens.colors.danger }}>{ficheError}</p>}
          <p style={{ color: tokens.colors.textMuted, fontSize: tokens.typography.small }}>
            {t('children.ref')} : {fiche.reference_number} · {t('common.room')} : {fiche.room_name ?? '—'} · {t('common.site')} : {fiche.site_name ?? '—'} · {t('invitation.status')} : {fiche.status}
          </p>
          <h4 style={{ margin: '16px 0 8px' }}>{t('child.roomMoves')}</h4>
          {(fiche.room_moves ?? []).length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
          <Table
            headers={[t('child.from'), t('child.to'), t('child.movedAt'), t('child.reason')]}
            rows={(fiche.room_moves ?? []).map((m) => [
              m.room_from ?? m.room_id_from?.slice(0, 8) ?? '—',
              m.room_to ?? m.room_id_to?.slice(0, 8) ?? '—',
              new Date(m.moved_at).toLocaleString('fr-FR'),
              m.reason ?? '—',
            ])}
          />
          <h4 style={{ margin: '16px 0 8px' }}>{t('child.statusHistory')}</h4>
          {(fiche.status_history ?? []).length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
          <Table
            headers={[t('child.from'), t('child.to'), t('child.changedAt'), t('child.reason')]}
            rows={(fiche.status_history ?? []).map((h) => [
              h.status_from ?? '—',
              h.status_to,
              new Date(h.changed_at).toLocaleString('fr-FR'),
              h.reason ?? '—',
            ])}
          />
        </div>
      )}
    </Card>
  );
}
