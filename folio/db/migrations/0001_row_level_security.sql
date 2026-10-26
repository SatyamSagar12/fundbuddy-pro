-- Row-level security: the database itself keeps each practice's data apart.
--
-- The app connects as the database owner, but every request that touches client data runs inside a
-- transaction that first does `SET LOCAL ROLE folio_app` and sets `app.practice_id` (src/server/db/scope.ts).
-- folio_app can only see and write rows of that one practice. When no practice is set, it sees nothing
-- (fails closed). Account tables are not granted to folio_app at all.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'folio_app') THEN
    CREATE ROLE folio_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT folio_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO folio_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_practice_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.practice_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_practice_id() TO folio_app;
--> statement-breakpoint

-- Practice data: full access to the current practice's rows only.
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE investors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE folios ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sips ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON families, investors, folios, transactions, sips TO folio_app;
--> statement-breakpoint
CREATE POLICY families_practice ON families TO folio_app
  USING (practice_id = app_practice_id()) WITH CHECK (practice_id = app_practice_id());
--> statement-breakpoint
CREATE POLICY investors_practice ON investors TO folio_app
  USING (practice_id = app_practice_id()) WITH CHECK (practice_id = app_practice_id());
--> statement-breakpoint
CREATE POLICY folios_practice ON folios TO folio_app
  USING (practice_id = app_practice_id()) WITH CHECK (practice_id = app_practice_id());
--> statement-breakpoint
CREATE POLICY transactions_practice ON transactions TO folio_app
  USING (practice_id = app_practice_id()) WITH CHECK (practice_id = app_practice_id());
--> statement-breakpoint
CREATE POLICY sips_practice ON sips TO folio_app
  USING (practice_id = app_practice_id()) WITH CHECK (practice_id = app_practice_id());
--> statement-breakpoint

-- Audit log: append-only for the app. No UPDATE or DELETE is granted, so history cannot be rewritten.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO folio_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_log_id_seq TO folio_app;
--> statement-breakpoint
CREATE POLICY audit_log_read ON audit_log FOR SELECT TO folio_app USING (practice_id = app_practice_id());
--> statement-breakpoint
CREATE POLICY audit_log_write ON audit_log FOR INSERT TO folio_app WITH CHECK (practice_id = app_practice_id());
--> statement-breakpoint

-- Shared market data: readable by everyone signed in, written only by the owner (NAV jobs).
ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE nav_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON instruments, nav_prices TO folio_app;
--> statement-breakpoint
CREATE POLICY instruments_read ON instruments FOR SELECT TO folio_app USING (true);
--> statement-breakpoint
CREATE POLICY nav_prices_read ON nav_prices FOR SELECT TO folio_app USING (true);
--> statement-breakpoint

-- Account tables: RLS on with no policies, so no role other than the owner can read them.
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE email_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Supabase: its public REST API runs as `anon` / `authenticated`. The Data API is switched off in the
-- dashboard; this removes their access as well, now and for tables created later.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END
$$;
