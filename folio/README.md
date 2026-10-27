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
