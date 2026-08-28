-- GENERATED FILE. Do not edit by hand.
-- Source: src/adapters/postgres/schema.ts
-- Regenerate: npm run schema:sql

CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS residents (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS societies (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS pickups (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS addons (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS water_logs (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS payment_intents (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS system_config (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS offerings (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS service_requests (id TEXT PRIMARY KEY, doc JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS device_tokens (id TEXT PRIMARY KEY, doc JSONB NOT NULL);

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

CREATE INDEX IF NOT EXISTS idx_orders_societyid ON orders ((doc->>'societyId'));
CREATE INDEX IF NOT EXISTS idx_orders_blockid ON orders ((doc->>'blockId'));
CREATE INDEX IF NOT EXISTS idx_orders_residentid ON orders ((doc->>'residentId'));
CREATE INDEX IF NOT EXISTS idx_orders_state ON orders ((doc->>'state'));
CREATE INDEX IF NOT EXISTS idx_orders_pickupid ON orders ((doc->>'pickupId'));
CREATE INDEX IF NOT EXISTS idx_orders_createdat ON orders ((doc->>'createdAt'));
CREATE INDEX IF NOT EXISTS idx_orders_assignedoperatoruserid ON orders ((doc->>'assignedOperatorUserId'));
CREATE INDEX IF NOT EXISTS idx_device_tokens_userid ON device_tokens ((doc->>'userId'));
CREATE INDEX IF NOT EXISTS idx_blocks_societyid ON blocks ((doc->>'societyId'));
CREATE INDEX IF NOT EXISTS idx_residents_blockid ON residents ((doc->>'blockId'));
CREATE INDEX IF NOT EXISTS idx_societies_supervisoruserid ON societies ((doc->>'supervisorUserId'));
CREATE INDEX IF NOT EXISTS idx_tickets_societyid ON tickets ((doc->>'societyId'));
CREATE INDEX IF NOT EXISTS idx_tickets_residentid ON tickets ((doc->>'residentId'));
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets ((doc->>'status'));
CREATE INDEX IF NOT EXISTS idx_tickets_createdat ON tickets ((doc->>'createdAt'));
CREATE INDEX IF NOT EXISTS idx_tickets_assignedtouserid ON tickets ((doc->>'assignedToUserId'));
CREATE INDEX IF NOT EXISTS idx_pickups_societyid ON pickups ((doc->>'societyId'));
CREATE INDEX IF NOT EXISTS idx_pickups_residentid ON pickups ((doc->>'residentId'));
CREATE INDEX IF NOT EXISTS idx_pickups_slotid ON pickups ((doc->>'slotId'));
CREATE INDEX IF NOT EXISTS idx_pickups_status ON pickups ((doc->>'status'));
CREATE INDEX IF NOT EXISTS idx_residents_societyid ON residents ((doc->>'societyId'));
CREATE INDEX IF NOT EXISTS idx_residents_userid ON residents ((doc->>'userId'));
CREATE INDEX IF NOT EXISTS idx_subscriptions_residentid ON subscriptions ((doc->>'residentId'));
CREATE INDEX IF NOT EXISTS idx_schedules_residentid ON schedules ((doc->>'residentId'));
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules ((doc->>'status'));
CREATE INDEX IF NOT EXISTS idx_service_requests_residentid ON service_requests ((doc->>'residentId'));
CREATE INDEX IF NOT EXISTS idx_service_requests_societyid ON service_requests ((doc->>'societyId'));
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests ((doc->>'status'));
CREATE INDEX IF NOT EXISTS idx_service_requests_assignedtouserid ON service_requests ((doc->>'assignedToUserId'));
CREATE INDEX IF NOT EXISTS idx_offerings_kind ON offerings ((doc->>'kind'));
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions ((doc->>'status'));
CREATE INDEX IF NOT EXISTS idx_notifications_userid ON notifications ((doc->>'userId'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_at ON audit_logs ((doc->>'at'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs ((doc->>'resource'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs ((doc->>'actor'));
CREATE INDEX IF NOT EXISTS idx_users_phone ON users ((doc->>'phone'));
CREATE INDEX IF NOT EXISTS idx_slots_date ON slots ((doc->>'date'));
CREATE INDEX IF NOT EXISTS idx_slots_society ON slots ((doc->>'societyId'));
CREATE INDEX IF NOT EXISTS idx_ledger_entry_txn ON ledger_entry (txn_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_account ON ledger_entry (account);
CREATE INDEX IF NOT EXISTS idx_ledger_txn_created ON ledger_txn (created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events (status);
