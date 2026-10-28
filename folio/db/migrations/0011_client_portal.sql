CREATE TABLE "portal_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"practice_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "portal_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "portal_code" text;--> statement-breakpoint
ALTER TABLE "portal_codes" ADD CONSTRAINT "portal_codes_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_codes_lookup_idx" ON "portal_codes" USING btree ("practice_id","email","created_at");--> statement-breakpoint
CREATE INDEX "portal_sessions_practice_idx" ON "portal_sessions" USING btree ("practice_id","email");--> statement-breakpoint
CREATE INDEX "investors_email_idx" ON "investors" USING btree ("practice_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "practices_portal_code_key" ON "practices" USING btree ("portal_code");--> statement-breakpoint

-- New account tables: row-level security on with no policies, so only the owner role (the sign-in code) can read them.
ALTER TABLE portal_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Client portal: a separate, read-only role. src/server/db/scope.ts (`withInvestors`) does
-- `SET LOCAL ROLE folio_portal` and sets app.practice_id and app.investor_ids (the signed-in client and their
-- family). The folio_app policies don't apply to this role; only the ones below do. It is granted SELECT only, and on
-- investors only the columns a portfolio needs: never the encrypted PAN, bank or nominee details, nor the notes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'folio_portal') THEN
    CREATE ROLE folio_portal NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT folio_portal TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO folio_portal;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_investor_ids() RETURNS uuid[]
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('app.investor_ids', true), '')::uuid[], '{}'::uuid[]) $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_practice_id(), app_investor_ids() TO folio_portal;
--> statement-breakpoint
GRANT SELECT (id, practice_id, family_id, name) ON investors TO folio_portal;
--> statement-breakpoint
GRANT SELECT ON families, folios, transactions, sips, instruments, nav_prices TO folio_portal;
--> statement-breakpoint
CREATE POLICY investors_portal ON investors FOR SELECT TO folio_portal
  USING (practice_id = app_practice_id() AND id = ANY (app_investor_ids()));
--> statement-breakpoint
-- The subquery on investors is itself filtered by the policy above.
CREATE POLICY families_portal ON families FOR SELECT TO folio_portal
  USING (practice_id = app_practice_id() AND id IN (SELECT family_id FROM investors));
--> statement-breakpoint
CREATE POLICY folios_portal ON folios FOR SELECT TO folio_portal
  USING (practice_id = app_practice_id() AND investor_id = ANY (app_investor_ids()));
--> statement-breakpoint
CREATE POLICY transactions_portal ON transactions FOR SELECT TO folio_portal
  USING (practice_id = app_practice_id() AND investor_id = ANY (app_investor_ids()));
--> statement-breakpoint
CREATE POLICY sips_portal ON sips FOR SELECT TO folio_portal
  USING (practice_id = app_practice_id() AND investor_id = ANY (app_investor_ids()));
--> statement-breakpoint
CREATE POLICY instruments_portal ON instruments FOR SELECT TO folio_portal USING (true);
--> statement-breakpoint
CREATE POLICY nav_prices_portal ON nav_prices FOR SELECT TO folio_portal USING (true);
