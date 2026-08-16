ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS dob date,
  ADD COLUMN IF NOT EXISTS bank_account_no text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS ifsc_code text,
  ADD COLUMN IF NOT EXISTS micr_code text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS nominee_pan text,
  ADD COLUMN IF NOT EXISTS nominee_mobile text,
  ADD COLUMN IF NOT EXISTS nominee_email text,
  ADD COLUMN IF NOT EXISTS nominee_relation text;