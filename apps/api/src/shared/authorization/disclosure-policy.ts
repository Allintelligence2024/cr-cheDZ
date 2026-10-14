/** H2a — authorization-matrix.md. Selected JWT role, never a caller-provided role.
 * 2.1/2.2 (loi 25-11) : privacy:manage est attribué au DPO (seed 003) ;
 * le dpo rejoint donc les opérateurs métier ici, sinon aucun rôle ne
 * pourrait à la fois passer le guard de route (@Permissions) et les
 * contrôles service (création/liste/détail/export par opérateur). */
export const PRIVACY_REQUEST_OPERATORS = new Set(['director', 'super_admin', 'dpo']);
export const canManagePrivacyRequests = (role: string): boolean => PRIVACY_REQUEST_OPERATORS.has(role);

/** Attendance notifications retain their separate can_receive_push policy. */
export { JOURNAL_NOTIFICATION_TYPES } from '@creche/prod-config';
