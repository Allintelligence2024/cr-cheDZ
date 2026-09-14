# Sync transport v1

See [the protocol and its explicit F2–F4 limitations](../../docs/architecture/sync-contract.md).

- `sync.schema.json`: JSON Schema draft-07 envelopes (not business payload schemas).
- `protocol.json`: route metadata and int64 cursor bound.
- `conformance.json`: shared positive/negative cases, **test inputs**, not claims of
  Dart execution. Real Dart-emitted requests are captured by the gate at runtime.
- `templates/client.dart.txt`: dependency-free generated-client template. Adding
  unsupported schema keywords fails generation instead of silently accepting them.

Generate: `node scripts/generate-sync-contract.mjs`.
Check: build API, then `node scripts/check-sync-contract.mjs` (Dart or Docker).
Local fallback: `--node-only` is explicitly incomplete and forbidden in CI.

No npm package or additional runtime dependency. The API imports its generated
cursor validator; AJV is test tooling only. The Flutter engine is not yet wired
into the generated Dart transport client. **Do not deploy this intermediate lot.**
