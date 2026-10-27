# Anqulas Folio

Back office for mutual fund distributors: clients, families, folios, SIPs and, next, automatic CAMS/KFintech
mailback import and daily NAVs. Product plan: [`../docs/SAAS-PLAN.md`](../docs/SAAS-PLAN.md).

This folder is a separate app from the old FundVault Lite app at the repo root. The root app keeps serving your
father until the switch-over. Changes here never rebuild or redeploy it: the old workflows ignore `folio/**`.

## What exists (phase 1, complete)

**Signing up and signing in**

- **Sign-up** creates a practice on a 30-day trial with Growth limits. **Email confirmation** happens by a button,
  not by opening the link, so mail scanners can't use it up.
- **Authenticator optional.** People sign in with email and password. Home recommends adding an authenticator app
  (Google or Microsoft Authenticator); anyone can turn it on or off in Settings → Security. Turning it off needs a
  current code. Setup shows **10 one-time recovery codes**.
- **Owner can require it.** Settings → Practice → "Require an authenticator app for everyone". Members without one
  must set it up at their next page load, and can't turn it off. The owner needs their own turned on first.
- **The platform console always requires it** (`/platform`), because it controls every practice and payment.
- **Lost phone.** On the code screen, "Lost your phone?" accepts a recovery code. It removes the old authenticator;
  the person sets up a new one (straight away if their practice requires it). You can also reset someone's authenticator from `/platform`
  after checking who they are.
- **Forgot password.** The emailed link works once, for 60 minutes. Resetting signs out every device; an authenticator,
  if turned on, is still needed afterwards.
- **Security emails** go out for password changes, authenticators turned off or reset, and new recovery codes.
- **Protections:**
  - 10 wrong passwords lock the account for 15 minutes.
  - Rate limits on every sign-in step.
  - A code is never accepted twice.
  - Answers never reveal whether an email has an account.
  - Sessions store only an HMAC of the cookie token.

**Separation and encryption**

- **Between practices, enforced by Postgres row-level security** (migrations 0001 and 0003). `test/rls.test.ts`
  and `test/subbroker.test.ts` prove the database refuses other practices' rows, sees nothing when no practice is
  set, keeps the audit log append-only, and limits a sub-broker to the clients assigned to them.
- **Encryption:** PAN, bank and nominee details are encrypted with each practice's own key, wrapped by
  `MASTER_KEY`. Clients can still be found by full PAN. Lists show `XXXXXX234F`.

**Team** (Settings → Team, owner only)

- Invite **staff** (see every client) or **sub-brokers** (see only clients assigned to them).
- Change a member's role, switch someone off (signed out at once), withdraw an invitation.
- On Clients, "Handled by" assigns a client to a team member.
- Plan user limits apply.

**Billing** (Settings → Billing, owner only)

- **Plans:** Starter, Growth and Pro, monthly or yearly. Prices and limits live only in `src/lib/plans.ts`.
- **Paying:**
  - The owner pays by UPI to your `UPI_ID` (QR code, or a link on a phone) and enters the 12-digit UTR.
  - You confirm it in `/platform`; only then is the period extended.
  - Remaining trial days are kept, and unused days convert when the plan changes.
  - A UTR can be claimed once.
- **When a plan ends:** a banner shows for 7 days before the end. After the end there are 3 days of grace, then the
  app locks to the billing page. Nothing is deleted.

**Platform console** (`/platform`)

- Only for `PLATFORM_ADMIN_EMAILS`, with an authenticator turned on and its code entered in the last 12 hours. Everyone else gets "not found".
- Totals and monthly revenue.
- UPI payments to confirm or reject (the owner is emailed either way).
- Per practice: extend the trial, record a payment made outside the app, suspend or restore.
- Reset someone's authenticator.

**Pages:** Home, Clients (search, "Handled by"), Settings (Practice, Team, Security, Billing).

**Import:** `scripts/import-fundvault.ts` brings in your father's data from the old app (below).

Not in phase 1:

- Choosing between practices for someone in two practices: they open the one they joined first.
- PhonePe or PayPal checkout (manual UPI only for now).
- GST invoices (decide GST with your CA first).

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
npx tsx scripts/e2e-auth.ts           # browser: sign-up and sign-in details (dev server running)
npx tsx scripts/e2e.ts                # browser: all of phase 1 (needs PLATFORM_ADMIN_EMAILS=e2e.platform@example.com
                                      # and a UPI_ID in .dev.vars; deletes earlier e2e.* test accounts)
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
   npx wrangler secret put PLATFORM_ADMIN_EMAILS   # your email: opens /platform
   npx wrangler secret put UPI_ID                  # where plan payments go, e.g. yourname@okhdfcbank
   ```
   Optionally set `UPI_PAYEE_NAME` the same way. It's the name payers see (default "Anqulas").
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
2. **Create his account.** Your father signs up at folio.anqulas.com with his own email.
3. **Dry run first**, then the real import:
   ```sh
   DATABASE_URL='<session pooler URL>' MASTER_KEY='<the production MASTER_KEY>' \
     npx tsx scripts/import-fundvault.ts --dir <folder> --owner <his email> --dry-run
   ```
   Check that it says "Totals match the old app", then run it again without `--dry-run`. His practice is marked
   billing-exempt.
4. Keep using the old app alongside for a few weeks. Delete the CSV files once done; they contain PANs and bank
   details.
