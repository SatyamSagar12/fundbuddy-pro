# Anqulas Folio

Back office for mutual fund distributors: clients, families, folios, SIPs and, next, automatic CAMS/KFintech
mailback import and daily NAVs. Product plan: [`../docs/SAAS-PLAN.md`](../docs/SAAS-PLAN.md).

This folder is a separate app from the old FundVault Lite app at the repo root. The root app keeps serving your
father until the switch-over. Changes here never rebuild or redeploy it: the old workflows ignore `folio/**`.

## What exists (phase 1, part 1)

- **Sign-up** creates a practice on a 30-day trial. **Email confirmation** happens by a button, not by opening
  the link, so mail scanners can't use it up.
- **Sign-in** requires an **authenticator app** (Google or Microsoft Authenticator) for every account. Nobody sees
  data before setting one up.
- **Lockouts and limits:**
  - 10 wrong passwords lock the account for 15 minutes.
  - Rate limits on sign-up, sign-in and codes.
  - A code is never accepted twice.
  - Answers never reveal whether an email has an account.
- **Sessions:**
  - The cookie holds a random token; only its HMAC is stored.
  - Sessions end after 7 days unused or 30 days in total.
  - A new token is issued after the authenticator step.
- **Practice separation is enforced by Postgres row-level security.** The app's queries run as a restricted role
  scoped to one practice. `test/rls.test.ts` proves the database refuses to read, write, update or delete another
  practice's rows, sees nothing when no practice is set, and keeps the audit log append-only.
- **Encryption:** PAN, bank and nominee details are encrypted with each practice's own key, wrapped by
  `MASTER_KEY`. Clients can still be found by full PAN through a keyed hash. The list shows `XXXXXX234F`.
- **Pages:** Home (counts, SIP inflow, recent transactions), Clients (search by name, mobile, email or full PAN),
  Settings (practice name, ARN, EUIN, owner only).
- **Old data import:** `scripts/import-fundvault.ts` brings in your father's clients, investments and SIPs from the
  old app's CSV exports. It encrypts sensitive fields, skips the 4 sample clients, is safe to re-run, has a dry
  run, and checks totals.

Still to do in phase 1:

- Password reset
- A recovery path for a lost phone
- Inviting staff
- Plans and UPI/PhonePe billing
- The platform admin page

## Stack

| Part | What |
|---|---|
| App + API | TanStack Start on **Cloudflare Workers** (`src/server.ts` is the entry: web requests + cron) |
| Database | **Postgres** (Supabase, Mumbai), reached through **Cloudflare Hyperdrive** |
| ORM | Drizzle (`src/server/db/schema.ts`); migrations in `db/migrations` |
| Email | Amazon SES (Mumbai) over HTTPS; locally printed to the console and shown at `/dev/outbox` |

## Local development

Needs Node 22 and a local Postgres 16+.

```sh
cd folio
npm install
./scripts/local-db.sh                 # creates databases folio and folio_test (needs sudo for postgres)
npm run db:migrate                    # local dev database
DATABASE_URL=postgres://folio_owner:folio_owner@127.0.0.1:5432/folio_test npm run db:migrate
cp .dev.vars.example .dev.vars        # then fill MASTER_KEY and SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # run twice
echo 'APP_URL=http://localhost:3000' >> .dev.vars
./scripts/dev-server.sh               # http://localhost:3000 (log in .wrangler/dev.log)
```

Checks:

```sh
npm run typecheck
npm test                              # encryption, codes, passwords, row-level security, import
npx tsx scripts/e2e-auth.ts           # browser: the whole sign-up and sign-in journey (dev server running)
```

Changing the database: edit `src/server/db/schema.ts`, then `npm run db:generate`. Every new practice table needs
row-level security in a custom migration (`npx drizzle-kit generate --custom --name <name>`); copy the pattern in
`0001_row_level_security.sql`. The RLS test fails if a table is left without it.

## Production setup (one time)

You do these steps, because they need your accounts and secrets. Never paste a secret into a chat or a commit.

1. **Database (done):** Supabase project in Mumbai, Data API off.
2. **Run the migrations:**
   - Supabase → Connect → copy the **Session pooler** URL (port 5432) and put your database password in it.
   - From `folio/`, run `DATABASE_URL='<that URL>' npm run db:migrate`.
3. **Cloudflare Workers Paid** ($5/month): Workers & Pages → Plans.
4. **Hyperdrive.** Use the same session pooler URL, with **caching off**. Caching is off so a stored answer can
   never be served to a different practice:
   ```sh
   npx wrangler hyperdrive create folio-db --caching-disabled --connection-string='<session pooler URL>'
   ```
   Put the printed id into `wrangler.jsonc` → `hyperdrive[0].id`.
5. **Secrets.** Generate each with the `node -e …` line above. Keep `MASTER_KEY` in your password manager too: if
   it is lost, encrypted PAN and bank details cannot be read.
   ```sh
   npx wrangler secret put MASTER_KEY
   npx wrangler secret put SESSION_SECRET
   ```
6. **Email (Amazon SES, Mumbai):**
   - Verify the domain `mail.folio.anqulas.com` with DKIM, then request production access.
   - Create an IAM user allowed only `ses:SendEmail`.
   - `npx wrangler secret put SES_ACCESS_KEY_ID` and `npx wrangler secret put SES_SECRET_ACCESS_KEY`.
7. **Deploy:** `npm run deploy`. Later, deploys run from GitHub (Actions → Anqulas Folio → Run workflow → deploy),
   once the `FOLIO_*` secrets listed in `.github/workflows/folio.yml` are added.
8. **Domain:** Workers & Pages → anqulas-folio → Settings → Domains & Routes → add `folio.anqulas.com`.

## Moving your father's data

1. **Export the old data.** In the old app's Lovable project → Cloud → Database, export the tables `clients`,
   `investments` and `sips` as CSV. Save them as `clients.csv`, `investments.csv` and `sips.csv` in one folder on
   your computer, not in this repo.
2. **Create his account.** Your father signs up at folio.anqulas.com with his own email and sets up his
   authenticator.
3. **Dry run first**, then the real import:
   ```sh
   DATABASE_URL='<session pooler URL>' MASTER_KEY='<the production MASTER_KEY>' \
     npx tsx scripts/import-fundvault.ts --dir <folder> --owner <his email> --dry-run
   ```
   Check that it says "Totals match the old app", then run it again without `--dry-run`. His practice is marked
   billing-exempt.
4. Keep using the old app alongside for a few weeks. Delete the CSV files once done; they contain PANs and bank
   details.
