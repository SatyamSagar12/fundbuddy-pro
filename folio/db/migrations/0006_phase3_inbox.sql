CREATE TABLE "inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_enc" text
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "briefing_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "inbox_code" text;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "mailback_password_enc" text;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_messages_practice_idx" ON "inbox_messages" USING btree ("practice_id","received_at");--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_inbox_code_unique" UNIQUE("inbox_code");--> statement-breakpoint
-- Received emails: written by the system (owner role); the practice's owner and staff can read and delete them.
-- Sub-brokers (limited members) never see them: a mailback covers every client of the practice.
ALTER TABLE "inbox_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, DELETE ON inbox_messages TO folio_app;--> statement-breakpoint
CREATE POLICY inbox_messages_practice ON inbox_messages TO folio_app
  USING (practice_id = app_practice_id() AND NOT app_limited());
