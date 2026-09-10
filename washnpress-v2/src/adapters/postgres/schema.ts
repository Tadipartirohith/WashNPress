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
  "users", "residents", "societies", "blocks", "units", "plans", "subscriptions",
  "pickups", "orders", "addons", "tickets", "water_logs", "audit_logs", "payment_intents",
  "notifications", "system_config", "schedules", "offerings", "service_requests",
  "device_tokens", "attachments", "refund_requests",
  // The timetable for additional services — car washes, at-home ironing. The store
  // has bound a collection to this table for as long as service slots have existed,
  // and the table was never in this list, so creating one on Postgres failed with
  // `relation "additional_service_slots" does not exist` and surfaced to a supervisor
  // as "Something went wrong". Nothing caught it because the suite runs on the
  // in-memory store, where a collection needs no table; `schemaDrift` below is the
  // test that would have.
  "additional_service_slots",
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
//
// An index here is only ever reached through `Collection.findBy`, which is the only
// thing in the store that emits a WHERE against a document field. `find(predicate)`
// filters in Node and cannot use any of them, so an index whose field is never named
// in a `findBy` is write amplification and nothing else. Every entry below is a field
// the application filters on today; when one stops being filtered on, it should go.
export function indexSql(): string {
  const index = (table: string, field: string) =>
    `CREATE INDEX IF NOT EXISTS idx_${table}_${field.toLowerCase()} ON ${table} ((doc->>'${field}'));`;
  return [
    index("orders", "societyId"),
    index("orders", "blockId"),
    index("orders", "residentId"),
    index("orders", "state"),
    index("orders", "pickupId"),
    index("orders", "createdAt"),
    index("orders", "assignedOperatorUserId"),
    index("device_tokens", "userId"),
    index("blocks", "societyId"),
    index("residents", "blockId"),
    index("societies", "supervisorUserId"),
    index("tickets", "societyId"),
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
    // The audit trail for one record — the most selective filter the audit list
    // offers, and the only one a support conversation actually starts from.
    index("audit_logs", "resourceId"),
    // A ticket's photographs. Read on every attachment upload to enforce the per
    // ticket limit, and again on every listing.
    index("attachments", "ticketId"),
    // The flats in a society, read whole for the water and sustainability figures.
    index("units", "societyId"),
    // Reached from the offering when a service is edited or withdrawn, to find out
    // what is already booked against it.
    index("service_requests", "offeringId"),
    // The gateway's own id for a payment. This is the lookup on the webhook path,
    // where the table is every payment ever attempted and the answer is one row.
    index("payment_intents", "providerOrderId"),
    // The additional-service timetable is filtered the same way the laundry slots
    // are, and had no indexes at all.
    index("additional_service_slots", "societyId"),
    index("additional_service_slots", "date"),
    // Two accounts may not share a phone number or an email address.
    //
    // The check lived only in the application, as a read followed by a write with
    // nothing between them, so two requests arriving together could both find the
    // number free and both take it. This is the guarantee; the service checks stay
    // because they are what produce a sentence the person can act on.
    //
    // Email is partial and folded: an account without an address is not an account
    // sharing a blank one, and addresses differing only in case are the same
    // address, which is the rule `sameEmail` applies everywhere else.
    //
    // Named apart from the plain index they replace. `IF NOT EXISTS` matches on the
    // name alone, so re-declaring `idx_users_phone` as UNIQUE against a database
    // that already had it silently kept the old, non-unique definition and the
    // guarantee never arrived — which is exactly what happened the first time.
    "DROP INDEX IF EXISTS idx_users_phone;",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone ON users ((doc->>'phone'));",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (lower(doc->>'email')) WHERE doc->>'email' IS NOT NULL AND doc->>'email' <> '';",
    "DROP INDEX IF EXISTS idx_users_email;",
    "CREATE INDEX IF NOT EXISTS idx_slots_date ON slots ((doc->>'date'));",
    "CREATE INDEX IF NOT EXISTS idx_slots_society ON slots ((doc->>'societyId'));",
    "CREATE INDEX IF NOT EXISTS idx_ledger_entry_txn ON ledger_entry (txn_id);",
    "CREATE INDEX IF NOT EXISTS idx_ledger_entry_account ON ledger_entry (account);",
    "CREATE INDEX IF NOT EXISTS idx_ledger_txn_created ON ledger_txn (created_at);",
    "CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events (status);",
  ].join("\n");
}
