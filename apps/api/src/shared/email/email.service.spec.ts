import { EmailService } from './email.service';
import { AppError } from '../errors';

/** ConfigService minimal : map plate + valeurs par défaut. */
function configOf(env: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string, fallback?: string) => env[key] ?? fallback),
  } as never;
}

function serviceWith(env: Record<string, string | undefined>): EmailService {
  const service = new EmailService(configOf(env));
  return service;
}

describe('EmailService — disponibilité (fail-closed)', () => {
  it('provider none + development → disponible (remise dev)', () => {
    const s = serviceWith({ NODE_ENV: 'development', EMAIL_PROVIDER: 'none' });
    expect(() => s.assertInvitationDeliveryAvailable()).not.toThrow();
  });

  it('provider none + production → 503 INVITATION_DELIVERY_UNAVAILABLE', () => {
    const s = serviceWith({ NODE_ENV: 'production', EMAIL_PROVIDER: 'none' });
    try {
      s.assertInvitationDeliveryAvailable();
      throw new Error('aurait dû lever');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('INVITATION_DELIVERY_UNAVAILABLE');
      expect((e as AppError).status).toBe(503);
    }
  });

  it('provider smtp sans SMTP_HOST → 503 avant toute écriture', () => {
    const s = serviceWith({ NODE_ENV: 'production', EMAIL_PROVIDER: 'smtp', SMTP_FROM: 'x@y.dz' });
    try {
      s.assertInvitationDeliveryAvailable();
      throw new Error('aurait dû lever');
    } catch (e) {
      expect((e as AppError).code).toBe('INVITATION_DELIVERY_UNAVAILABLE');
    }
  });

  it('provider smtp sans SMTP_FROM → 503', () => {
    const s = serviceWith({ NODE_ENV: 'production', EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.y.dz' });
    expect(() => s.assertInvitationDeliveryAvailable()).toThrow(/INVITATION|configuré/);
  });

  it('provider smtp complet → disponible en production', () => {
    const s = serviceWith({ NODE_ENV: 'production', EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.y.dz', SMTP_FROM: 'x@y.dz' });
    expect(() => s.assertInvitationDeliveryAvailable()).not.toThrow();
  });
});

describe('EmailService — envoi et retries', () => {
  const baseEnv = {
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.y.dz',
    SMTP_PORT: '587',
    SMTP_FROM: 'no-reply@creche.dz',
    APP_URL: 'https://creche.dz',
  };

  function withFakeTransport(env: Record<string, string>) {
    const s = serviceWith(env);
    const sendMail = jest.fn();
    jest
      .spyOn(s as unknown as { buildTransport: () => unknown }, 'buildTransport')
      .mockReturnValue({ sendMail });
    return { s, sendMail };
  }

  it('envoi réussi à la première tentative', async () => {
    const { s, sendMail } = withFakeTransport(baseEnv);
    sendMail.mockResolvedValue({});
    await s.sendInvitation('parent@test.dz', 'tok-123', 'Les Poussins');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('parent@test.dz');
    expect(mail.from).toBe('no-reply@creche.dz');
    expect(mail.subject).toContain('Les Poussins');
    expect(mail.html).toContain('https://creche.dz/accept-invitation?token=tok-123');
    expect(mail.html).toContain('dir="rtl"'); // partie arabe
    expect(mail.text).toContain('tok-123');
  });

  it('échec transitoire puis succès → retry, un seul envoi final', async () => {
    const { s, sendMail } = withFakeTransport(baseEnv);
    sendMail.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce({});
    await s.sendInvitation('parent@test.dz', 'tok', 'Org');
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('échec définitif après 3 tentatives → 502 EMAIL_DELIVERY_FAILED', async () => {
    const { s, sendMail } = withFakeTransport(baseEnv);
    sendMail.mockRejectedValue(new Error('connection refused'));
    await expect(s.sendInvitation('parent@test.dz', 'tok', 'Org')).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_FAILED',
      status: 502,
    });
    expect(sendMail).toHaveBeenCalledTimes(3);
  }, 15000);

  it('le jeton n’apparaît jamais dans les logs', async () => {
    const { s, sendMail } = withFakeTransport(baseEnv);
    const logSpy = jest.spyOn((s as unknown as { logger: { log: (m: string) => void } }).logger, 'log');
    sendMail.mockResolvedValue({});
    await s.sendInvitation('parent@test.dz', 'SECRET-TOKEN-XYZ', 'Org');
    for (const call of logSpy.mock.calls) {
      expect(String(call[0])).not.toContain('SECRET-TOKEN-XYZ');
    }
  });

  it('reçu de paiement : silencieux si transport indisponible (jamais bloquant)', async () => {
    const s = serviceWith({ NODE_ENV: 'production', EMAIL_PROVIDER: 'none' });
    const spy = jest.spyOn(s as unknown as { send: (...args: string[]) => Promise<void> }, 'send');
    await expect(
      s.sendPaymentReceipt({ to: 'p@test.dz', orgName: 'O', receiptNumber: 'REC-1', amount: 500, method: 'cash' }),
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('reçu de paiement : un échec d’envoi ne lève jamais', async () => {
    const { s, sendMail } = withFakeTransport(baseEnv);
    sendMail.mockRejectedValue(new Error('smtp down'));
    await expect(
      s.sendPaymentReceipt({ to: 'p@test.dz', orgName: 'O', receiptNumber: 'REC-1', amount: 500, method: 'cash' }),
    ).resolves.toBeUndefined(); // best-effort : pas d'exception
  }, 15000);
});
