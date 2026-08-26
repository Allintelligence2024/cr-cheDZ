import { useEffect, useState } from 'react';
import React from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { ApiError, http } from '../api/client';
import { useI18n } from '../i18n';

interface Staff {
  id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  qualification: string;
  contract_type: string;
  hire_date: string;
  is_active: boolean;
  active_assignments: number;
}

interface RoleAssignment {
  id: string;
  user_id: string;
  role_id: string;
  slug: string;
  name: string;
  created_at: string;
}

/** Rôles assignables (hors super_admin/parents — gérés par invitations). */
const ASSIGNABLE_ROLES: Array<{ slug: string; name: string }> = [
  { slug: 'director', name: 'Directrice' },
  { slug: 'educator', name: 'Éducatrice' },
  { slug: 'accountant', name: 'Comptable' },
  { slug: 'receptionist', name: 'Réception' },
];

export function StaffPage(): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<Staff[]>([]);
  const [userId, setUserId] = useState('');
  const [qualification, setQualification] = useState('educator_qualified');
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Multi-rôles : cible de la modale + rôles additionnels par user
  const [roleTarget, setRoleTarget] = useState<Staff | null>(null);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [selectedRole, setSelectedRole] = useState('educator');
  const [roleLoading, setRoleLoading] = useState(false);

  const load = (): void => {
    http
      .get<{ items: Staff[] }>('/staff')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.messageFr));
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await http.post('/staff', { user_id: userId, qualification, hire_date: hireDate });
      setUserId('');
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.messageFr : '');
    }
  };

  /** Ouvre la modale multi-rôles et charge les assignations du membre. */
  const openRoles = async (s: Staff): Promise<void> => {
    setError(null);
    setRoleTarget(s);
    setRoleLoading(true);
    try {
      const r = await http.get<RoleAssignment[]>(`/members/${s.user_id}/roles`);
      setRoleAssignments(r);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.messageFr ?? t('common.error') : t('common.error'));
    } finally {
      setRoleLoading(false);
    }
  };

  const assignRole = async (): Promise<void> => {
    if (!roleTarget) return;
    setError(null);
    setMessage(null);
    try {
      await http.post(`/members/${roleTarget.user_id}/roles`, { role_id: selectedRole });
      setMessage(t('roles.assigned'));
      await openRoles(roleTarget);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.messageFr ?? t('common.error') : t('common.error'));
    }
  };

  const removeRole = async (assignmentId: string): Promise<void> => {
    if (!roleTarget) return;
    setError(null);
    setMessage(null);
    try {
      await http.del(`/role-assignments/${assignmentId}`);
      setMessage(t('roles.removed'));
      await openRoles(roleTarget);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.messageFr ?? t('common.error') : t('common.error'));
    }
  };

  const roleName = (slug: string): string => ASSIGNABLE_ROLES.find((r) => r.slug === slug)?.name ?? slug;

  const qualifications = [
    ['educator_qualified', 'Éducatrice qualifiée'],
    ['director', 'Directrice'],
    ['nurse', 'Infirmière'],
    ['admin', 'Administratif'],
    ['other', 'Autre'],
  ];

  return (
    <Card title={t('staff.title')}>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <TextField label={t('staff.user')} value={userId} onChange={setUserId} required dir="ltr" />
        <label style={{ fontSize: tokens.typography.small, color: tokens.colors.textMuted }}>
          {t('staff.qualification')}
          <select
            value={qualification}
            onChange={(e) => setQualification(e.target.value)}
            style={{ display: 'block', padding: '10px 12px', borderRadius: 6, border: `1px solid ${tokens.colors.border}`, marginTop: 4 }}
          >
            {qualifications.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <TextField label={t('staff.hireDate')} value={hireDate} onChange={setHireDate} type="date" dir="ltr" />
        <Button type="submit">{t('staff.create')}</Button>
      </form>
      {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
      {message && <p style={{ color: '#16A34A' }}>{message}</p>}
      <Table
        headers={['Nom', 'Email', t('staff.qualification'), 'Contrat', t('staff.hireDate'), 'Affect.', t('common.actions')]}
        rows={items.map((s) => [
          `${s.first_name} ${s.last_name}`,
          s.email,
          s.qualification,
          s.contract_type,
          s.hire_date,
          String(s.active_assignments),
          <Button key="r" variant="ghost" onClick={() => void openRoles(s)}>{t('roles.manage')}</Button>,
        ])}
      />
      {items.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}

      {roleTarget && (
        <div style={{ marginTop: tokens.spacing.lg, border: `1px solid ${tokens.colors.border}`, borderRadius: tokens.radius.md, padding: tokens.spacing.lg }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{t('roles.title')} — {roleTarget.first_name} {roleTarget.last_name}</h3>
            <Button variant="ghost" onClick={() => setRoleTarget(null)}>{t('common.close')}</Button>
          </div>
          <p style={{ color: tokens.colors.textMuted, fontSize: tokens.typography.small }}>
            {t('roles.primary')} : <strong>{roleTarget.qualification}</strong> · {t('roles.additional')}
          </p>
          {roleLoading && <p style={{ color: tokens.colors.textMuted }}>{t('common.loading')}</p>}
          <Table
            headers={[t('roles.role'), t('common.date'), '']}
            rows={roleAssignments.map((ra) => [
              roleName(ra.slug),
              new Date(ra.created_at).toLocaleDateString('fr-FR'),
              <Button key="x" variant="danger" onClick={() => void removeRole(ra.id)}>{t('roles.remove')}</Button>,
            ])}
          />
          {!roleLoading && roleAssignments.length === 0 && <p style={{ color: tokens.colors.textMuted }}>{t('common.empty')}</p>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: tokens.spacing.md }}>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              style={{ padding: '10px 12px', borderRadius: 6, border: `1px solid ${tokens.colors.border}` }}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r.slug} value={r.slug} disabled={roleAssignments.some((ra) => ra.slug === r.slug)}>
                  {r.name}
                </option>
              ))}
            </select>
            <Button onClick={() => void assignRole()} disabled={roleLoading || roleAssignments.some((ra) => ra.slug === selectedRole)}>
              {t('roles.assign')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
