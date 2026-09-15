-- F3a: immutable outcome for replay, committed with the business transaction.
-- 006 and 001–052 remain unchanged. No reconstruction from current business
-- state: a historical conflict's original version cannot be inferred safely.
ALTER TABLE sync_operations ADD COLUMN response_outcome jsonb;
ALTER TABLE sync_operations ADD CONSTRAINT sync_operations_outcome_shape CHECK (
  response_outcome IS NULL OR COALESCE(
    jsonb_typeof(response_outcome) = 'object'
    AND response_outcome->>'status' = status
    AND status IN ('accepted', 'rejected', 'conflict'), false)
);
COMMENT ON COLUMN sync_operations.response_outcome IS
  'F3a committed CommandOutcome, replayed without executing the command; NULL for historical operations. INTERNAL_ERROR is rolled back, never persisted.';
