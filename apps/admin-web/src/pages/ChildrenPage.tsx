import React from 'react';
import { useEffect, useState } from 'react';
import { Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
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
        // XLSX : parsing côté client (import dynamique pour le poids du bundle)
        const XLSX = await import('xlsx');
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        rows = json.map((r) => {
          const obj: Record<string, string> = {};
          for (const h of HEADERS) {
            const v = r[h] ?? r[h.toUpperCase()] ?? '';
            obj[h] = String(v).trim();
          }
          return obj;
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
    } catch (e: any) {
      setError(e.messageFr ?? 'Erreur lors de l\'import');
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
        headers={[t('children.ref'), t('common.name'), t('children.birth'), 'Genre', t('room.title'), t('invitation.status')]}
        rows={items.map((c) => [
          c.reference_number,
          `${c.first_name_fr} ${c.last_name_fr}`,
          c.date_of_birth.slice(0, 10),
          c.gender ?? '—',
          c.room_id ? c.room_id.slice(0, 8) : '—',
          c.status,
        ])}
      />
      {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
    </Card>
  );
}
