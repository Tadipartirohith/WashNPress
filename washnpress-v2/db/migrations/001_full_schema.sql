-- Production oriented schema for the full backend. Mirrors src/domain/models.ts.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(10) NOT NULL UNIQUE CHECK (phone ~ '^[6-9][0-9]{9}$'),
  full_name VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','deleted')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE roles (id SMALLINT PRIMARY KEY, name VARCHAR(30) NOT NULL UNIQUE);
CREATE TABLE user_roles (user_id UUID REFERENCES users(id) ON DELETE CASCADE, role_id SMALLINT REFERENCES roles(id), PRIMARY KEY (user_id, role_id));

CREATE TABLE societies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL, city VARCHAR(100) NOT NULL, state VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','coming_soon','inactive'))
);
CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL, water_recycling_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  base_draw_paise BIGINT NOT NULL DEFAULT 0, revenue_share_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
);
CREATE TABLE residents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  society_id UUID NOT NULL REFERENCES societies(id),
  unit_number VARCHAR(30) NOT NULL, tower_block VARCHAR(30), preferred_windows TEXT[] DEFAULT '{}'
);

CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier VARCHAR(30) NOT NULL UNIQUE, garment_cap INTEGER NOT NULL CHECK (garment_cap > 0),
  turnaround_hours INTEGER NOT NULL, monthly_paise BIGINT NOT NULL, annual_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES residents(id), plan_id UUID NOT NULL REFERENCES plans(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active', cycle VARCHAR(10) NOT NULL,
  cycle_start TIMESTAMPTZ NOT NULL, cycle_end TIMESTAMPTZ NOT NULL,
  garments_used INTEGER NOT NULL DEFAULT 0 CHECK (garments_used >= 0), auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  pending_plan_id UUID, pause_until TIMESTAMPTZ, cancel_reason TEXT
);
CREATE INDEX idx_sub_resident_status ON subscriptions(resident_id, status);

CREATE TABLE pickup_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES societies(id), slot_date DATE NOT NULL, slot_window VARCHAR(20) NOT NULL,
  start_time TIME NOT NULL, end_time TIME NOT NULL,
  capacity_total INTEGER NOT NULL CHECK (capacity_total >= 0),
  capacity_remaining INTEGER NOT NULL CHECK (capacity_remaining >= 0), is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_slots_society_date ON pickup_slots(society_id, slot_date, slot_window);

CREATE TABLE pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES residents(id), society_id UUID NOT NULL REFERENCES societies(id),
  slot_id UUID NOT NULL REFERENCES pickup_slots(id), scheduled_for TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled', recurring BOOLEAN NOT NULL DEFAULT FALSE,
  recurring_days INTEGER[] DEFAULT '{}', special_instructions TEXT
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_code VARCHAR(20) NOT NULL UNIQUE,
  pickup_id UUID REFERENCES pickups(id), resident_id UUID NOT NULL REFERENCES residents(id),
  society_id UUID NOT NULL REFERENCES societies(id), subscription_id UUID REFERENCES subscriptions(id),
  state VARCHAR(30) NOT NULL, qr_batch_code VARCHAR(20), items JSONB NOT NULL DEFAULT '[]',
  addon_ids UUID[] DEFAULT '{}', pickup_count INTEGER, delivery_count INTEGER,
  qc_passed BOOLEAN, qc_reason TEXT, discrepancy_reason TEXT, rating SMALLINT, rating_comment TEXT,
  timeline JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state <> 'qc_hold' OR qc_reason IS NOT NULL)
);
CREATE INDEX idx_orders_state ON orders(state, created_at);
CREATE INDEX idx_orders_qr ON orders(qr_batch_code);

CREATE TABLE addons (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(80) NOT NULL, price_paise BIGINT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE);

CREATE TABLE ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reference TEXT NOT NULL,
  entries JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_entries_gin ON ledger_transactions USING GIN (entries);

CREATE TABLE processed_events (event_id TEXT PRIMARY KEY, processed_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), resident_id UUID REFERENCES residents(id), order_id UUID REFERENCES orders(id),
  category VARCHAR(40) NOT NULL, description TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'open',
  priority VARCHAR(10) NOT NULL DEFAULT 'normal', messages JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_status ON support_tickets(status, priority);

CREATE TABLE water_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), unit_id UUID NOT NULL REFERENCES units(id), order_id UUID REFERENCES orders(id),
  liters_used NUMERIC(10,2) NOT NULL, liters_saved NUMERIC(10,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (token UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, roles TEXT[] NOT NULL, resident_id UUID, society_id UUID, expires_at TIMESTAMPTZ NOT NULL);

CREATE TABLE outbox_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), type TEXT NOT NULL, payload JSONB NOT NULL, status VARCHAR(10) NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_outbox_pending ON outbox_events(status) WHERE status = 'pending';

CREATE TABLE audit_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());
