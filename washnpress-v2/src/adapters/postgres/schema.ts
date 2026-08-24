// The one authoritative schema. db/init.sql is generated from this file by
// `npm run schema:sql` and a test fails if the two drift apart, because a second
// hand-maintained copy is how the container came to start with four tables missing.
//
// Schema for Postgres storage mode. Correctness-critical data uses real columns
// (slot capacity for atomic reservation, ledger entries for balance queries,
// processed events for idempotency). The remaining entities are stored as JSON
// documents keyed by id, which persists across restarts and keeps the DataStore
// interface identical to the in-memory adapter.
export const DOC_TABLES = [
  "users", "residents", "societies", "units", "plans", "subscriptions",
  "pickups", "orders", "addons", "tickets", "water_logs", "audit_logs", "payment_intents",
  "areas", "notifications", "system_config", "schedules", "offerings", "service_requests",
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

${indexSql()}
`.trim();
}

// Indexes on the JSONB fields that are actually filtered on. Documents are stored
// whole, so without these every scoped query is a sequential scan of the table:
// an operator asking for their society's orders reads every order in the platform.
// Expression indexes work directly against the stored document, so nothing about
// the shape of the data has to change.
export function indexSql(): string {
  const index = (table: string, field: string) =>
    `CREATE INDEX IF NOT EXISTS idx_${table}_${field.toLowerCase()} ON ${table} ((doc->>'${field}'));`;
  return [
    index("orders", "societyId"),
    index("orders", "areaId"),
    index("orders", "residentId"),
    index("orders", "state"),
    index("orders", "pickupId"),
    index("orders", "createdAt"),
    index("orders", "assignedOperatorUserId"),
    index("tickets", "societyId"),
    index("tickets", "areaId"),
    index("tickets", "residentId"),
    index("tickets", "status"),
    index("tickets", "createdAt"),
    index("tickets", "assignedToUserId"),
    index("pickups", "societyId"),
    index("pickups", "residentId"),
    index("pickups", "slotId"),
    index("pickups", "status"),
    index("residents", "societyId"),
    index("residents", "userId"),
    index("societies", "areaId"),
    index("subscriptions", "residentId"),
    index("schedules", "residentId"),
    index("schedules", "status"),
    index("service_requests", "residentId"),
    index("service_requests", "societyId"),
    index("service_requests", "status"),
    index("service_requests", "assignedToUserId"),
    index("offerings", "kind"),
    index("subscriptions", "status"),
    index("notifications", "userId"),
    index("audit_logs", "at"),
    index("audit_logs", "resource"),
    index("audit_logs", "actor"),
    "CREATE INDEX IF NOT EXISTS idx_users_phone ON users ((doc->>'phone'));",
    "CREATE INDEX IF NOT EXISTS idx_slots_date ON slots ((doc->>'date'));",
    "CREATE INDEX IF NOT EXISTS idx_slots_society ON slots ((doc->>'societyId'));",
    "CREATE INDEX IF NOT EXISTS idx_ledger_entry_txn ON ledger_entry (txn_id);",
    "CREATE INDEX IF NOT EXISTS idx_ledger_entry_account ON ledger_entry (account);",
    "CREATE INDEX IF NOT EXISTS idx_ledger_txn_created ON ledger_txn (created_at);",
    "CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events (status);",
  ].join("\n");
}
