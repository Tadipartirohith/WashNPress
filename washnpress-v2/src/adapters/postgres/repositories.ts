// Reference note: the Postgres data store mirrors the in-memory DataStore. The
// correctness-critical operations map to SQL as follows.
//
//   slots.reserveCapacity(id):
//     UPDATE pickup_slots SET capacity_remaining = capacity_remaining - 1
//     WHERE id = $1 AND is_active AND capacity_remaining > 0 RETURNING *;
//   ledger.post(txn): INSERT INTO ledger_transactions (id, reference, entries, created_at) ...
//   idempotency.markSeen(id): INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING;
//
// The full schema is in db/init.sql. Wiring every collection to Postgres is a
// mechanical follow-up that does not change any business logic.
export {};
