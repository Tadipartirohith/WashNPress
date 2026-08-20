// Schema for Postgres storage mode. Correctness-critical data uses real columns
// (slot capacity for atomic reservation, ledger entries for balance queries,
// processed events for idempotency). The remaining entities are stored as JSON
// documents keyed by id, which persists across restarts and keeps the DataStore
// interface identical to the in-memory adapter.
export const DOC_TABLES = [
  "users", "residents", "societies", "units", "plans", "subscriptions",
  "pickups", "orders", "addons", "tickets", "water_logs", "audit_logs", "payment_intents",
  "areas", "notifications", "system_config",
] as const;

export function schemaSql(): string {
  const docTables = DOC_TABLES.map(
    (t) => `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, doc JSONB NOT NULL);`,
  ).join("\n");
  return `
${docTables}

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  doc JSONB NOT NULL,
  capacity_remaining INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, doc JSONB NOT NULL);

CREATE TABLE IF NOT EXISTS outbox_events (id TEXT PRIMARY KEY, doc JSONB NOT NULL, status TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS ledger_txn (id TEXT PRIMARY KEY, reference TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger_entry (txn_id TEXT NOT NULL, idx INTEGER NOT NULL, account TEXT NOT NULL, direction TEXT NOT NULL, amount BIGINT NOT NULL);

CREATE TABLE IF NOT EXISTS processed_events (event_id TEXT PRIMARY KEY);
`.trim();
}
