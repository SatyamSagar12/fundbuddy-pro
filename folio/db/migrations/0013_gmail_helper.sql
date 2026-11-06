ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "gmail_token_hash" text;--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_gmail_token_hash_unique" UNIQUE("gmail_token_hash");
