import React from 'react';
import { useEffect, useState } from 'react';
import { Button, Card, Table, TextField, tokens } from '@creche/design-system';
import { ApiError, http } from '../api/client';
import { useI18n } from '../i18n';

interface HealthRecord {
  blood_type: string | null;
  family_doctor: string | null;
  doctor_phone: string | null;
  health_insurance: string | null;
  chronic_conditions: string | null;
  general_notes: string | null;
}

interface Allergy {
  id: string;
  allergen: string;
  allergen_type: string;
  severity: string;
  reaction: string | null;
  emergency_protocol: string | null;
  is_active: boolean;
}

interface Vaccination {
  id: string;
  vaccine_name: string;
  dose_number: number | null;
  administered_date: string | null;
  next_dose_date: string | null;
  verified: boolean;
}

interface MedAuth {
  id: string;
  medication_name: string;
  dosage: string;
  frequency: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  verified_at: string | null;
  guardian_first_name: string | null;
  guardian_last_name: string | null;
}

interface MedAdmin {
  id: string;
  authorization_id: string;
  administered_at: string;
  dose_given: string;
  observations: string | null;
  confirmed_by: string | null;
  administered_by_name: string;
}

interface HealthData {
  record: HealthRecord | null;
  allergies: Allergy[];
  vaccinations: Vaccination[];
  medication_authorizations: MedAuth[];
  medication_administrations: MedAdmin[];
}

export function HealthPage(): React.JSX.Element {
  const { t } = useI18n();
  const [childId, setChildId] = useState('');
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Formulaire rapide : allergie
  const [allergen, setAllergen] = useState('');
  const [severity, setSeverity] = useState('moderate');
  // Formulaire rapide : vaccination
  const [vaccine, setVaccine] = useState('');
  // Formulaire rapide : administration
  const [authId, setAuthId] = useState('');
  const [dose, setDose] = useState('');

  const load = (): void => {
    if (!childId) {
      setData(null);
      return;
    }
    http
      .get<HealthData>(`/health/${childId}`)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.messageFr : ''));
  };
  useEffect(load, [childId]);

  const act = async (fn: () => Promise<unknown>, okKey: string): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(t(okKey));
      load();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.messageFr ?? t('common.error') : t('common.error'));
    }
  };

  const addAllergy = () => act(
    () => http.post(`/health/${childId}/allergies`, { allergen, allergen_type: 'food', severity }),
    'health.allergyAdded',
  );
  const addVaccine = () => act(
    () => http.post(`/health/${childId}/vaccinations`, { vaccine_name: vaccine }),
    'health.vaccineAdded',
  );
  const addAdmin = () => act(
    () => http.post(`/health/${childId}/medication-administrations`, {
      authorization_id: authId,
      administered_at: new Date().toISOString(),
      dose_given: dose,
    }),
    'health.adminAdded',
  );
  const confirmAdmin = (id: string) => act(
    () => http.post(`/health/medication-administrations/${id}/confirm`, {}),
    'health.adminConfirmed',
  );

  const sevColor = (s: string): string => (s === 'life_threatening' || s === 'severe' ? '#DC2626' : s === 'moderate' ? '#B45309' : '#16A34A');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
      <Card title={t('health.title')}>
        <div style={{ display: 'flex', gap: tokens.spacing.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 260 }}>
            <TextField label={t('common.child') + ' (UUID)'} value={childId} onChange={setChildId} dir="ltr" />
          </div>
          <Button variant="ghost" onClick={load}>{t('common.refresh')}</Button>
        </div>
        {error && <p style={{ color: tokens.colors.danger }}>{error}</p>}
        {message && <p style={{ color: '#16A34A' }}>{message}</p>}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.lg }}>
            <div>
              <h3 style={{ margin: '12px 0 8px', fontSize: 15 }}>Dossier</h3>
              <p style={{ margin: 0, fontSize: 14 }}>
                Groupe sanguin : {data.record?.blood_type ?? '—'} · Médecin : {data.record?.family_doctor ?? '—'} ({data.record?.doctor_phone ?? '—'})<br />
                Assurance : {data.record?.health_insurance ?? '—'}<br />
                <strong>Pathologies chroniques :</strong> {data.record?.chronic_conditions ?? '—'}<br />
                {data.record?.general_notes ?? ''}
              </p>
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>{t('health.allergies')} ({data.allergies.length})</h3>
              <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
                <TextField label="Allergène" value={allergen} onChange={setAllergen} />
                <TextField label={t('health.severity')} value={severity} onChange={setSeverity} />
                <Button onClick={() => void addAllergy()} disabled={!allergen || !childId}>{t('health.addAllergy')}</Button>
              </div>
              <Table
                headers={['Allergène', t('health.severity'), 'Réaction', 'Protocole', 'Actif']}
                rows={data.allergies.map((a) => [
                  a.allergen,
                  <span key="s" style={{ color: sevColor(a.severity), fontWeight: 600 }}>{a.severity}</span>,
                  a.reaction ?? '—',
                  a.emergency_protocol ?? '—',
                  a.is_active ? t('common.yes') : t('common.no'),
                ])}
              />
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>{t('health.vaccinations')} ({data.vaccinations.length})</h3>
              <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
                <TextField label={t('health.vaccine')} value={vaccine} onChange={setVaccine} />
                <Button onClick={() => void addVaccine()} disabled={!vaccine || !childId}>{t('health.addVaccine')}</Button>
              </div>
              <Table
                headers={['Vaccin', 'Dose', t('common.date'), 'Prochaine dose', 'Vérifié']}
                rows={data.vaccinations.map((v) => [
                  v.vaccine_name,
                  v.dose_number ?? '—',
                  v.administered_date ?? '—',
                  v.next_dose_date ?? '—',
                  v.verified ? t('common.yes') : t('common.no'),
                ])}
              />
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>{t('health.medications')} ({data.medication_authorizations.length})</h3>
              <Table
                headers={['Médicament', 'Dosage', 'Fréquence', 'Période', 'Gardien', 'Vérifié']}
                rows={data.medication_authorizations.map((m) => [
                  m.medication_name,
                  m.dosage,
                  m.frequency,
                  `${m.start_date} → ${m.end_date ?? '…'}`,
                  `${m.guardian_first_name ?? ''} ${m.guardian_last_name ?? ''}`.trim() || '—',
                  m.verified_at ? new Date(m.verified_at).toLocaleDateString('fr-FR') : '—',
                ])}
              />
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>{t('health.administrations')} ({data.medication_administrations.length})</h3>
              <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
                <TextField label="Autorisation (UUID)" value={authId} onChange={setAuthId} dir="ltr" />
                <TextField label="Dose" value={dose} onChange={setDose} />
                <Button onClick={() => void addAdmin()} disabled={!authId || !dose || !childId}>{t('health.addAdmin')}</Button>
              </div>
              <Table
                headers={['Quand', 'Dose', 'Observations', 'Par', 'Confirmation']}
                rows={data.medication_administrations.map((a) => [
                  new Date(a.administered_at).toLocaleString('fr-FR'),
                  a.dose_given,
                  a.observations ?? '—',
                  a.administered_by_name,
                  a.confirmed_by
                    ? <span key="c" style={{ color: '#16A34A' }}>{t('health.adminConfirmed')}</span>
                    : <Button key="b" variant="ghost" onClick={() => void confirmAdmin(a.id)}>{t('health.confirm')}</Button>,
                ])}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
