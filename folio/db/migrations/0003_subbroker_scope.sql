-- New account tables: row-level security on with no policies, so only the owner role can read them.
ALTER TABLE recovery_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Sub-brokers (and any member marked limited) see only the clients assigned to them, and only those
-- clients' folios, transactions and SIPs. src/server/db/scope.ts sets app.user_id and app.limited.
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_limited() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.limited', true), '') = '1' $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_id(), app_limited() TO folio_app;
--> statement-breakpoint

DROP POLICY investors_practice ON investors;
--> statement-breakpoint
CREATE POLICY investors_practice ON investors TO folio_app
  USING (practice_id = app_practice_id() AND (NOT app_limited() OR assigned_user_id = app_user_id()))
  WITH CHECK (practice_id = app_practice_id() AND (NOT app_limited() OR assigned_user_id = app_user_id()));
--> statement-breakpoint

-- The subquery on investors is itself filtered by the policy above, so a limited member only matches
-- rows of their own clients.
DROP POLICY folios_practice ON folios;
--> statement-breakpoint
CREATE POLICY folios_practice ON folios TO folio_app
  USING (practice_id = app_practice_id() AND (NOT app_limited() OR investor_id IN (SELECT id FROM investors)))
  WITH CHECK (practice_id = app_practice_id() AND (NOT app_limited() OR investor_id IN (SELECT id FROM investors)));
--> statement-breakpoint
DROP POLICY transactions_practice ON transactions;
--> statement-breakpoint
CREATE POLICY transactions_practice ON transactions TO folio_app
  USING (practice_id = app_practice_id() AND (NOT app_limited() OR investor_id IN (SELECT id FROM investors)))
  WITH CHECK (practice_id = app_practice_id() AND (NOT app_limited() OR investor_id IN (SELECT id FROM investors)));
--> statement-breakpoint
DROP POLICY sips_practice ON sips;
--> statement-breakpoint
CREATE POLICY sips_practice ON sips TO folio_app
  USING (practice_id = app_practice_id() AND (NOT app_limited() OR investor_id IN (SELECT id FROM investors)))
  WITH CHECK (practice_id = app_practice_id() AND (NOT app_limited() OR investor_id IN (SELECT id FROM investors)));
