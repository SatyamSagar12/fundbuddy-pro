# Anqulas Folio

Back office for mutual fund distributors: clients, families, folios, SIPs, daily AMFI NAVs with current value,
gains and XIRR, and, next, automatic CAMS/KFintech mailback import. Product plan: [`../docs/SAAS-PLAN.md`](../docs/SAAS-PLAN.md).

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

**Everyday screens (from the old FundVault app):**

- **Clients:**
  - add, edit and delete;
  - a detail page with contact, PAN, bank and nominee details, the client's SIPs and investments, and totals;
  - search, "Handled by", and CSV export.
- **Investments:**
  - add, edit and delete one-time, SIP and redemption entries, with payment mode and transaction ID;
  - filter by client; CSV export.
- **SIPs:**
  - add, edit and delete (monthly or quarterly; active, paused or stopped);
  - monthly commitment shown; CSV export.
- **Reports:**
  - monthly SIP vs one-time flow, SIP trend, Indian financial-year totals and top schemes;
  - totals strip;
  - client and period filters;
  - a table view, and monthly or yearly CSV export.

**Also:**

- **Settings** (Practice, Team, Security, Billing).
- **Google sign-in.** It appears once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; the redirect URI is
  `<site>/auth/google/callback`.
- **Install on a phone:** a manifest, icons and a service worker that caches nothing.

**Import:** `scripts/import-fundvault.ts` brings in your father's data from the old app (below).

Not in phase 1:

- Choosing between practices for someone in two practices: they open the one they joined first.
- PhonePe or PayPal checkout (manual UPI only for now).
- GST invoices (decide GST with your CA first).

## Phase 2 so far: NAVs and valuation

- **Daily NAVs.** Every scheme's name, codes, category and latest NAV come from AMFI's daily file
  (`NAVAll.txt`, about 15,000 schemes). Only changed rows are written.
  - When: in the background after any page request, once the last import is over 6 hours old. Only one app
    instance does it at a time; a failed try is retried after an hour.
  - On demand: `/platform` → **Import NAVs now**, or `POST /__maintenance/nav` with the `MIGRATE_TOKEN`.
  - A short or broken download is refused, so yesterday's NAVs stay.
- **NAV history.** Kept only for schemes clients hold. The first time a scheme is used, its history is downloaded
  from mfapi.in from the earliest entry on; after that the daily file adds each day's NAV.
- **Scheme picker.** The scheme field on Investments and SIPs searches AMFI schemes as you type. A typed name
  that exactly matches one scheme is linked when saved. A regular-plan growth option ranks first unless the name
  says direct or IDCW.
- **Match schemes** (`/app/schemes`, linked from Home and Investments).
  - Lists every typed scheme name not linked yet, largest first, with suggestions.
  - **Use all exact matches** links the certain ones in one click.
  - Renamed schemes (e.g. "ICICI Prudential Bluechip Fund" → "Large Cap Fund") are suggested by their new
    name; any other scheme can be searched.
- **Units.** An entry linked to a scheme gets units = amount ÷ that day's NAV (or the next day with a NAV), less
  the 0.005% stamp duty on purchases since July 2020. They are marked "≈" (estimated); registrar files will give
  exact units.
- **Value, gain and return.**
  - Holdings use the latest NAV, with average cost for redemptions.
  - XIRR is shown once money has been invested for a year; before that, the plain return.
  - On Home: total current value and gain. On Clients: each client's value. On a client's page: a holdings
    table, with unmatched schemes listed at their invested amount.

Still to come in phase 2: CAMS and KFintech mailback files, and CAS PDF import. These need sample files to build
against.

Local NAV data without internet:

```sh
npx tsx scripts/nav-import.ts --file <a NAVAll.txt> --synthetic-history   # made-up history, local database only
npx tsx scripts/e2e-nav.ts                                                # browser test of phase 2
```

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
npx tsx scripts/e2e-records.ts        # browser: clients, investments, SIPs, reports, CSV, install files
npx tsx scripts/e2e.ts                # browser: all of phase 1 (needs PLATFORM_ADMIN_EMAILS=e2e.platform@example.com
                                      # and a UPI_ID in .dev.vars; deletes earlier e2e.* test accounts)
```

Changing the database: edit `src/server/db/schema.ts`, then `npm run db:generate`. Every new practice table needs
row-level security in a custom migration (`npx drizzle-kit generate --custom --name <name>`); copy the pattern in
`0001_row_level_security.sql`. The RLS test fails if a table is left without it.

## Where it runs now (Cloudflare Pages)

- **Live:** `https://anqulas-folio.pages.dev`, and `https://folio.anqulas.com` once the Namecheap CNAME
  `folio → anqulas-folio.pages.dev` is in place.
- **Project:** the Cloudflare Pages project `anqulas-folio` (production branch `main`), holding:
  - the Hyperdrive binding `HYPERDRIVE` (`folio-db`, caching off)
  - the secrets `MASTER_KEY`, `SESSION_SECRET`, `MIGRATE_TOKEN`, `PLATFORM_ADMIN_EMAILS`
- **Why Pages:** a Pages site can use a domain whose DNS is elsewhere (Namecheap).
- **Publish a new version:**
  ```sh
  npm run build:pages
  npx wrangler pages deploy dist/pages --project-name anqulas-folio --branch main
  ```
  Run the deploy from a folder without `wrangler.jsonc`, or copy `dist/pages` elsewhere first.
- **Database:** the first request after a publish applies new migrations itself (`src/server/maintenance.ts`, safe
  when several instances start at once). `POST /__maintenance/migrate` with `Authorization: Bearer <MIGRATE_TOKEN>`
  does it on demand.
- **First admin:** the first sign-up with an email in `PLATFORM_ADMIN_EMAILS` is approved at once, but only while
  no admin account exists. Later sign-ups wait for approval in `/platform` until an email service is set up.
- **Not on Pages:** scheduled jobs. Hourly housekeeping doesn't run there. The NAV import doesn't need it: it runs in
  the background after page requests (see phase 2 above).

## Putting it online (Cloudflare builds it from GitHub)

Cloudflare builds and publishes the app on every push to the connected branch, the way Vercel does. Each build
also creates or updates the database tables (`npm run cf:build`).

1. **Hyperdrive (done):** `folio-db`, caching off. Its id is in `wrangler.jsonc`.
2. **Plan:** Workers & Pages → Plans → **Workers Paid** ($5/month). On the free plan, checking a password exceeds
   the 10 ms limit per request, so sign-in fails.
3. **Connect the repo:** Workers & Pages → Create → **Import a repository** → GitHub → `fundbuddy-pro`, then set:
   - **Project name:** `anqulas-folio`
   - **Branch:** `claude/vigilant-thompson-421bkm`, or `main` once merged
   - **Root directory:** `folio`
   - **Build command:** `npm run cf:build`
   - **Deploy command:** `npx wrangler deploy`
   - **Build variables:**
     - `DATABASE_URL`: the Supabase Mumbai **session pooler** URL with your password
     - `PLATFORM_ADMIN_EMAILS`: your email
4. **Secrets.** After the first build: the Worker `anqulas-folio` → Settings → Variables and secrets → Add, type
   **Secret**:
   - `MASTER_KEY`: random text of 32+ characters. **Keep a copy**: without it, PAN and bank details can't be read.
   - `SESSION_SECRET`: a different random text of 32+ characters.
   - `PLATFORM_ADMIN_EMAILS`: your email.
   - Optional: `UPI_ID`, plus `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY` once email is set up.
5. **Make yourself the admin:**
   - Open the app's address and sign up with your admin email.
   - Then Deployments → **Retry build**. The build approves an admin sign-up made in the last 24 hours, because
     nobody can confirm their email until an email service is set up.
   - Sign in, turn on an authenticator (Settings → Security), and open `/platform`. Approve other sign-ups there.
6. **Domain:** the Worker → Settings → Domains & Routes → Add → Custom domain → `folio.anqulas.com`. This needs
   anqulas.com's DNS on Cloudflare.

The GitHub job `.github/workflows/folio-publish.yml` does the same from GitHub Actions, if you prefer that.

**Later:**

- **Email (Amazon SES, Mumbai):**
  - Verify `mail.folio.anqulas.com` with DKIM, and request production access.
  - Create an IAM user allowed only `ses:SendEmail`.
  - Add `FOLIO_SES_ACCESS_KEY_ID` and `FOLIO_SES_SECRET_ACCESS_KEY`, then run the workflow again.
  - Confirmation, reset and invitation emails then go out by themselves.
- **Your domain:**
  - Workers & Pages → anqulas-folio → Settings → Domains & Routes → add `folio.anqulas.com`. This needs
    anqulas.com's DNS on Cloudflare.
  - Then set `APP_URL` to `https://folio.anqulas.com` in Settings → Variables.

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
