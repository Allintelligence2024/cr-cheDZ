import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { http } from '../api/client';
import { useI18n } from '../i18n';

interface Contract {
  id: string;
  child_id: string;
  reference_number: string | null;
  schedule_type: string;
  monthly_base_amount: string;
  discount_percent: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

interface Invoice {
  id: string;
  invoice_number: string;
  child_id: string;
  period_year: number;
  period_month: number;
  total_amount: string;
  paid_amount: string;
  balance: string;
  status: string;
  due_date: string;
  pdf_url: string | null;
}

interface Payment {
  id: string;
  reference_number: string;
  receipt_number: string | null;
  child_id: string;
  amount: string;
  method: string;
  status: string;
  confirmed_at: string | null;
}

interface CashRegister {
  id: string;
  site_id: string;
  register_date: string;
  opening_balance: string;
  closing_balance: string | null;
  total_cash_in: string;
  closed_at: string | null;
}

type Tab = 'contracts' | 'invoices' | 'payments' | 'cash';

const TAB_KEYS: Array<{ id: Tab; label: string }> = [
  { id: 'contracts', label: 'bill.contracts' },
  { id: 'invoices', label: 'bill.invoices' },
  { id: 'payments', label: 'bill.payments' },
  { id: 'cash', label: 'bill.cashRegister' },
];

export function BillingPage(): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('contracts');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {TAB_KEYS.map((tabDef) => (
          <Button key={tabDef.id} variant={tab === tabDef.id ? 'primary' : 'ghost'} onClick={() => setTab(tabDef.id)}>
            {t(tabDef.label)}
          </Button>
        ))}
      </div>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {message && <p style={{ color: '#16A34A' }}>{message}</p>}
      {tab === 'contracts' && <ContractsTab onError={setError} onMessage={setMessage} />}
      {tab === 'invoices' && <InvoicesTab onError={setError} onMessage={setMessage} />}
      {tab === 'payments' && <PaymentsTab onError={setError} onMessage={setMessage} />}
      {tab === 'cash' && <CashTab onError={setError} onMessage={setMessage} />}
    </div>
  );
}

// ── Contrats ────────────────────────────────────────────────────────────────

function ContractsTab({ onError, onMessage }: { onError: (m: string) => void; onMessage: (m: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Contract[]>([]);
  const [childId, setChildId] = useState('');
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [discount, setDiscount] = useState('');

  const load = (): void => {
    http.get<Contract[]>('/billing/contracts').then(setItems).catch((e: any) => onError(e.messageFr ?? ""));
  };
  useEffect(load, []);

  const create = async (): Promise<void> => {
    onError('');
    try {
      await http.post('/billing/contracts', {
        child_id: childId,
        monthly_base_amount: Number(amount),
        start_date: startDate,
        discount_percent: discount ? Number(discount) : 0,
      });
      onMessage(t('bill.contractCreated'));
      setChildId(''); setAmount(''); setStartDate(''); setDiscount('');
      load();
    } catch (e: any) {
      onError(e.messageFr);
    }
  };

  return (
    <Card title={t('bill.contracts')}>
      <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 240 }}><TextField label={t('bill.childId')} value={childId} onChange={setChildId} dir="ltr" /></div>
        <div style={{ minWidth: 160 }}><TextField label={t('bill.monthlyBase')} type="number" value={amount} onChange={setAmount} /></div>
        <div style={{ minWidth: 160 }}><TextField label={t('bill.startDate')} type="date" value={startDate} onChange={setStartDate} /></div>
        <div style={{ minWidth: 120 }}><TextField label={t('bill.discount')} type="number" value={discount} onChange={setDiscount} /></div>
        <Button onClick={() => void create()} disabled={!childId || !amount || !startDate}>{t('bill.createContract')}</Button>
      </div>
      <Table
        headers={['Réf.', t('common.child'), t('bill.monthlyBase'), 'Remise', t('bill.startDate'), t('common.status')]}
        rows={items.map((c) => [
          c.reference_number ?? '—',
          c.child_id.slice(0, 8),
          `${Number(c.monthly_base_amount).toLocaleString('fr-FR')} DZD`,
          `${c.discount_percent ?? 0} %`,
          c.start_date,
          c.is_active ? t('common.yes') : t('common.no'),
        ])}
      />
    </Card>
  );
}

// ── Factures ────────────────────────────────────────────────────────────────

function InvoicesTab({ onError, onMessage }: { onError: (m: string) => void; onMessage: (m: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Invoice[]>([]);
  const [contractId, setContractId] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState('1');
  const [dueDate, setDueDate] = useState('');

  const load = (): void => {
    http.get<Invoice[]>('/billing/invoices').then(setItems).catch((e: any) => onError(e.messageFr ?? ""));
  };
  useEffect(load, []);

  const generate = async (): Promise<void> => {
    onError('');
    try {
      await http.post('/billing/invoices/generate', {
        contract_id: contractId,
        period_year: Number(year),
        period_month: Number(month),
        due_date: dueDate,
      });
      onMessage(t('bill.invoiceCreated'));
      setContractId(''); setDueDate('');
      load();
    } catch (e: any) {
      onError(e.messageFr);
    }
  };

  const downloadPdf = async (id: string): Promise<void> => {
    try {
      const res = await fetch(`/api/v1/billing/invoices/${id}/pdf`, {
        headers: { authorization: `Bearer ${localStorage.getItem('creche_access_token') ?? ''}` },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      onError(t('common.error'));
    }
  };

  /** Demande l'export Excel des factures du mois affiché (job worker → ExportsPage). */
  const exportExcel = async (): Promise<void> => {
    onError('');
    try {
      const period = `${year}-${String(month).padStart(2, '0')}`;
      await http.post('/exports', { report_type: 'invoices', period });
      onMessage(`${t('bill.exportRequested')} (${period})`);
    } catch (e: any) {
      onError(e.messageFr ?? t('common.error'));
    }
  };

  return (
    <Card title={t('bill.invoices')}>
      <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 240 }}><TextField label={t('bill.contract')} value={contractId} onChange={setContractId} dir="ltr" /></div>
        <div style={{ minWidth: 110 }}><TextField label={t('bill.periodYear')} type="number" value={year} onChange={setYear} /></div>
        <div style={{ minWidth: 90 }}><TextField label={t('bill.periodMonth')} type="number" value={month} onChange={setMonth} /></div>
        <div style={{ minWidth: 160 }}><TextField label={t('bill.dueDate')} type="date" value={dueDate} onChange={setDueDate} /></div>
        <Button onClick={() => void generate()} disabled={!contractId || !year || !month || !dueDate}>{t('bill.generateInvoice')}</Button>
        <Button variant="ghost" onClick={() => void exportExcel()} disabled={!year || !month}>{t('bill.exportExcel')}</Button>
      </div>
      <Table
        headers={['N°', t('bill.period'), t('common.total'), t('bill.paidAmount'), t('bill.balance'), t('common.status'), t('bill.dueDate'), 'PDF']}
        rows={items.map((i) => [
          i.invoice_number,
          `${String(i.period_month).padStart(2, '0')}/${i.period_year}`,
          `${Number(i.total_amount).toLocaleString('fr-FR')} DZD`,
          `${Number(i.paid_amount).toLocaleString('fr-FR')} DZD`,
          <span key="b" style={{ color: Number(i.balance) > 0 ? '#F59E0B' : '#16A34A' }}>{`${Number(i.balance).toLocaleString('fr-FR')} DZD`}</span>,
          t(`invoice.status.${i.status}`) ?? i.status,
          i.due_date,
          i.pdf_url ? <Button key="p" variant="ghost" onClick={() => void downloadPdf(i.id)}>{t('bill.pdf')}</Button> : '—',
        ])}
      />
    </Card>
  );
}

// ── Paiements ───────────────────────────────────────────────────────────────

function PaymentsTab({ onError, onMessage }: { onError: (m: string) => void; onMessage: (m: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Payment[]>([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');

  const load = (): void => {
    http.get<Payment[]>('/billing/payments').then(setItems).catch((e: any) => onError(e.messageFr ?? ""));
  };
  useEffect(load, []);

  const pay = async (): Promise<void> => {
    onError('');
    try {
      await http.post('/billing/payments/cash', { invoice_id: invoiceId, amount: Number(amount) });
      onMessage(t('bill.paymentMade'));
      setInvoiceId(''); setAmount('');
      load();
    } catch (e: any) {
      onError(e.messageFr);
    }
  };

  return (
    <Card title={t('bill.payments')}>
      <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 240 }}><TextField label={t('bill.invoiceId')} value={invoiceId} onChange={setInvoiceId} dir="ltr" /></div>
        <div style={{ minWidth: 140 }}><TextField label={t('common.amount') + ' (DZD)'} type="number" value={amount} onChange={setAmount} /></div>
        <Button onClick={() => void pay()} disabled={!invoiceId || !amount}>{t('bill.cashPayment')}</Button>
      </div>
      <Table
        headers={['Réf.', t('common.child'), t('common.amount'), 'Méthode', t('common.status'), 'Reçu']}
        rows={items.map((p) => [
          p.reference_number,
          p.child_id.slice(0, 8),
          `${Number(p.amount).toLocaleString('fr-FR')} DZD`,
          p.method,
          p.status,
          p.receipt_number ?? '—',
        ])}
      />
    </Card>
  );
}

// ── Caisse ──────────────────────────────────────────────────────────────────

function CashTab({ onError, onMessage }: { onError: (m: string) => void; onMessage: (m: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<CashRegister[]>([]);
  const [siteId, setSiteId] = useState('');
  const [opening, setOpening] = useState('0');

  const load = (): void => {
    http.get<CashRegister[]>('/billing/cash-registers').then(setItems).catch((e: any) => onError(e.messageFr ?? ""));
  };
  useEffect(load, []);

  const open = async (): Promise<void> => {
    onError('');
    try {
      await http.post('/billing/cash-register/open', { site_id: siteId, opening_balance: Number(opening) });
      onMessage(t('bill.registerOpened'));
      load();
    } catch (e: any) {
      onError(e.messageFr);
    }
  };

  const close = async (): Promise<void> => {
    onError('');
    try {
      await http.post('/billing/cash-register/close', { site_id: siteId });
      onMessage(t('bill.registerClosed'));
      load();
    } catch (e: any) {
      onError(e.messageFr);
    }
  };

  return (
    <Card title={t('bill.cashRegister')}>
      <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 240 }}><TextField label={t('bill.siteId')} value={siteId} onChange={setSiteId} dir="ltr" /></div>
        <div style={{ minWidth: 140 }}><TextField label={t('bill.openingBalance')} type="number" value={opening} onChange={setOpening} /></div>
        <Button onClick={() => void open()} disabled={!siteId}>{t('bill.openRegister')}</Button>
        <Button variant="ghost" onClick={() => void close()} disabled={!siteId}>{t('bill.closeRegister')}</Button>
      </div>
      <Table
        headers={[t('bill.registerDate'), t('common.site'), 'Ouverture', 'Entrées espèces', 'Clôture', t('bill.closedAt')]}
        rows={items.map((r) => [
          r.register_date,
          r.site_id.slice(0, 8),
          `${Number(r.opening_balance).toLocaleString('fr-FR')} DZD`,
          `${Number(r.total_cash_in).toLocaleString('fr-FR')} DZD`,
          r.closing_balance != null ? `${Number(r.closing_balance).toLocaleString('fr-FR')} DZD` : '—',
          r.closed_at ? new Date(r.closed_at).toLocaleString('fr-FR') : '—',
        ])}
      />
    </Card>
  );
}
