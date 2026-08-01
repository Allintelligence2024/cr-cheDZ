-- ============================================================================
-- 001_extensions_and_types.sql
-- Extensions PostgreSQL et types énumérés.
-- Règles : une migration appliquée ne se modifie jamais (ADR-007).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Types énumérés -------------------------------------------------------------

CREATE TYPE user_status AS ENUM (
  'pending', 'active', 'suspended', 'deleted'
);

CREATE TYPE child_status AS ENUM (
  'pre_registered', 'active', 'on_leave', 'departed'
);

CREATE TYPE attendance_status AS ENUM (
  'expected', 'present', 'absent', 'departed', 'cancelled'
);

CREATE TYPE meal_quantity AS ENUM (
  'none', 'little', 'half', 'good', 'all'
);

CREATE TYPE invoice_status AS ENUM (
  'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'
);

CREATE TYPE payment_method AS ENUM (
  'cash', 'bank_transfer', 'cib', 'edahabia', 'other'
);

CREATE TYPE payment_status AS ENUM (
  'pending', 'confirmed', 'failed', 'refunded'
);

CREATE TYPE notification_channel AS ENUM (
  'push', 'in_app', 'sms', 'whatsapp'
);

CREATE TYPE media_type AS ENUM (
  'photo', 'document', 'avatar'
);

CREATE TYPE consent_type AS ENUM (
  'data_processing',
  'photo_individual',
  'photo_group',
  'photo_public',
  'photo_marketing',
  'medication_administration',
  'emergency_medical_care',
  'communication_whatsapp'
);

CREATE TYPE document_type AS ENUM (
  'birth_certificate',
  'vaccination_record',
  'medical_certificate',
  'prescription',
  'id_photo',
  'enrollment_contract',
  'insurance',
  'other'
);

CREATE TYPE job_status AS ENUM (
  'pending', 'processing', 'done', 'failed', 'cancelled'
);

CREATE TYPE sync_command AS ENUM (
  'check_in', 'check_out', 'mark_absent',
  'log_meal', 'log_nap_start', 'log_nap_end', 'log_diaper',
  'log_activity', 'log_temperature', 'log_note', 'add_photo',
  'log_incident', 'correct_attendance'
);

CREATE TYPE audit_action AS ENUM (
  'create', 'read', 'update', 'delete', 'export',
  'login', 'logout', 'impersonate', 'revoke', 'approve'
);
