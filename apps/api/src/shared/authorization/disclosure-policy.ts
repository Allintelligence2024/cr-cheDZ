/** H2a — authorization-matrix.md. Selected JWT role, never a caller-provided role. */
export const PRIVACY_REQUEST_OPERATORS = new Set(['director', 'super_admin']);
export const canManagePrivacyRequests = (role: string): boolean => PRIVACY_REQUEST_OPERATORS.has(role);

/** Attendance notifications retain their separate can_receive_push policy. */
export const JOURNAL_NOTIFICATION_TYPES = new Set(['meal', 'nap_end', 'incident']);
