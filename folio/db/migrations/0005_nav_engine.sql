CREATE TABLE "market_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "scheme_type" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "latest_nav" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "latest_nav_date" date;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "history_from" date;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "units_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_instrument_idx" ON "transactions" USING btree ("instrument_id");--> statement-breakpoint
-- System job state: owner only (row-level security on, no policies, nothing granted to folio_app).
ALTER TABLE "market_state" ENABLE ROW LEVEL SECURITY;
