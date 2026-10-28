# Anqulas Folio

Back office for mutual fund distributors: clients, families, folios, SIPs, daily AMFI NAVs with current value,
gains and XIRR, and CAMS / KFintech / CAS imports. Product plan: [`../docs/SAAS-PLAN.md`](../docs/SAAS-PLAN.md).

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

## Phase 2 (complete): NAVs, valuation and registrar imports

- **Daily NAVs.** Every scheme's name, codes, category and latest NAV come from AMFI's daily file
  (`NAVAll.txt`, about 15,000 schemes). Only changed rows are written.
  - The file's columns are found from its header. Since 2026 AMFI puts Plan and Option in their own columns;
    Folio adds them back to the scheme name ("HDFC Flexi Cap Fund - Regular Plan - Growth Option").
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

- **Registrar reports** (Import, owners and staff).
  - Accepts CAMS and KFintech transaction reports as mailed: password ZIP, DBF, CSV/TXT or Excel (.xlsx). Old
    .xls files must be saved as .xlsx first.
  - Columns are found by any of their known names, so report versions with renamed or reordered columns still
    read. A report missing a needed column is refused, naming what's missing.
  - Taxes, stamp duty, rejected rows and detail changes are left out, and listed.
- **Client CAS** (Import → Client CAS): the detailed CAS PDF from CAMS or KFintech, opened with its password.
  - Every scheme is checked: opening balance + each row's units must equal the closing balance. A scheme that
    doesn't add up is left out and named.
  - Folios held through another ARN, or direct, are marked as held elsewhere.
- **Privacy.** Files are opened in the browser (`src/lib/imports`). ZIP and PDF passwords never reach the server;
  only the transactions do.
- **Before saving**, a preview shows what will happen to each row:
  - **Client:** the one chosen, else found by PAN, else by folio, else by an exact name when only one client has
    it, else a new client (PAN encrypted as usual).
  - **Scheme:** found by ISIN, else by an exact name; anything left goes to Match schemes.
  - **Already in:** a file sent twice, or a CAS overlapping a CAMS report, adds nothing again.
  - **Replaces typed entries:** an entry typed by hand with the same client, direction and scheme, an amount
    within ₹1 and a date within 5 days is replaced by the registrar's, which has exact units.

Built against the published layouts and the open-source casparser project's reading of CAS statements, and
tested on made-up files (`test/fixtures/imports`). Real files will show what still needs adjusting.

Local NAV data without internet:

```sh
npx tsx scripts/nav-import.ts --file <a NAVAll.txt> --synthetic-history   # made-up history, local database only
npx tsx scripts/e2e-nav.ts                                                # browser test: NAVs and valuation
npx tsx scripts/e2e-import.ts                                             # browser test: registrar and CAS imports
```

## Phase 3 (built): SIP book, morning briefing, email import

- **SIP book** (`/app/sips`). SIPs are found in the registrars' own transactions, not typed in
  (`src/lib/sip-book.ts`, `src/server/sip-book.ts`).
  - Instalments are grouped by client, folio and scheme. A reversal of the same amount within 45 days is a
    **bounce** (that's how CAMS and KFintech report a returned instalment).
  - From the rhythm of instalments: weekly, monthly or quarterly, the next date, and a status. **Active**: the
    last one went through. **Bounced**: the latest was returned. **Missed**: nothing for over one cycle.
    **Stopped**: nothing for three.
  - SIPs typed by hand or brought from the old app still show. When registrar data has the same SIP (same
    client and scheme), it is listed once, with the registrar's status, and stays editable. A typed SIP can have
    a last-instalment date; it shows as **ending soon** 45 days before.
  - Filters (All, Active, Bounced, Missed, Ending soon, Stopped), SIP money received per month for the last 12
    months, and a CSV export.
- **Morning briefing** (`src/server/briefing.ts`, text in `src/lib/briefing-text.ts`).
  - On Home, under **Today**: bounced SIPs, redemptions of ₹1 lakh or more in the last 7 days, and birthdays in
    the next 7 days. Each has **Call** and **WhatsApp** buttons; WhatsApp opens the client's chat with a
    ready-written message.
  - Also on Home: SIP instalments in the last 7 days, SIPs due this week, missed and ending-soon SIPs, and the
    change in value since the previous NAV.
  - The same, by email, at about 8 am India time, to each owner, staff member and sub-broker (sub-brokers see
    only their clients). Each person can switch it off in Settings → Practice → Morning summary.
  - Needs an email service (SES) and `APP_URL`; until then nothing is sent.
- **Email import** (Settings → Email import, owners and staff; `src/server/inbox.ts`).
  - Each practice gets a private address, `mb-<12 letters>@<INBOUND_DOMAIN>`. The owner can make a new one if the
    old one leaks.
  - The distributor saves the mailback ZIP password once (encrypted with the practice's key), adds the address
    in Gmail and creates one filter: from `camsonline.com OR kfintech.com OR karvy.com`, forward it. Gmail's
    confirmation code appears on the page, so no inbox access is needed. The page walks through the steps.
  - **Only trusted mail is imported:** it must come from the registrars' domains, not fail its DKIM check, and carry
    a password-protected ZIP that opens with the saved password. So someone who learns the address still can't add
    transactions. Everything else is listed as "not imported".
  - Transaction reports import exactly like an upload (same client and scheme matching, never twice). Other
    reports in the ZIP are skipped and named.
  - If the password is missing or wrong, the email is kept (encrypted) and imports as soon as the right password is
    saved. **Received emails** lists each one with what it added; failed ones can be retried.
  - Ignored emails are deleted after 30 days, the rest after a year.
- **How email gets in:** Cloudflare Email Routing on the inbound domain → the small Worker in
  `workers/folio-mail` → `POST /__inbox` (with `INBOX_TOKEN`). The same Worker calls `POST /__inbox/tick` every
  30 minutes, which runs the NAV import and the 8 am briefing even when nobody opens the app.

Setting it up (once):

1. Buy a separate domain for receiving (any cheap one), add it to Cloudflare (free plan), and switch on
   **Email Routing** for it.
2. Deploy the Worker and give it the token:
   ```sh
   npx wrangler deploy -c workers/folio-mail/wrangler.jsonc
   npx wrangler secret put INBOX_TOKEN -c workers/folio-mail/wrangler.jsonc   # 32+ random characters
   ```
3. In Email Routing → Routing rules, set the **catch-all** to "Send to a Worker" → `folio-mail`.
4. On the Pages project, set `INBOUND_DOMAIN` (the domain) and the same `INBOX_TOKEN` as a secret.

Browser test: `npx tsx scripts/e2e-phase3.ts` (needs `INBOUND_DOMAIN` and `INBOX_TOKEN` in `.dev.vars`).

## Phase 4 (built on `claude/folio-phase4`): families, capital gains, client statements, client portal

- **Families** (Clients → **Families**).
  - A family groups clients under a head, for example husband, wife and parents.
  - Start one from the Families list (**New family**) or from a client's page (**Start a family**, with that
    client as the head and the family named after them).
  - On a client's page, the Family card can add the client to a family, move them, take them out, or make them
    the head.
  - The Families view shows each family's value, invested amount, gain and XIRR (or the plain return in its
    first year), worked out over all its members' money together, plus its members. CSV export.
  - A family's page has the same figures, each member's value, and every holding with whose it is.
  - **Sub-brokers** see only families that hold one of their own clients, and inside them only their own clients
    (row-level security, migration 0010). They can start families and edit the ones they see, but not delete one.
    Deleting a family never deletes its clients; they're only ungrouped.

- **Capital gains** per financial year: **Capital gains** on a client's or a family's page, or on Reports once a
  client is chosen.
  - Each sale (redemption or switch out) uses up the oldest units of the same folio and scheme first (FIFO).
    Purchases, SIP instalments, switches in and reinvested IDCW are the units, at their amount.
  - Split into short-term and long-term, with the rate for each piece. A summary groups gains by how they're
    taxed, applies the yearly equity exemption (₹1.25 L; per person in a family), and estimates the tax before
    surcharge and cess. Gains taxed at slab are shown as income to add, not as tax.
  - **Rules** live in one versioned table, `src/lib/tax-rules.ts` (checked 28 Oct 2026 against the FY 2026-27 AMC
    tax reckoners; Budget 2026 changed nothing). A Budget change is a new row there.
    - Equity funds: long-term after 12 months. From 23 Jul 2024, 12.5% above ₹1.25 L a year, short-term 20%.
      Before that 10% above ₹1 L and 15%; before 1 Apr 2018, long-term exempt.
    - Equity units bought by 31 Jan 2018 are **grandfathered**: cost = the higher of the actual cost and the lower
      of the 31 Jan 2018 value and the sale value. The 31 Jan 2018 NAV comes from the stored history, or is fetched
      once from mfapi.in (only that week is stored).
    - Debt funds bought on or after 1 Apr 2023: always at slab. Older units: long-term after 24 months at 12.5%
      (sold before 23 Jul 2024: after 36 months, 20% with indexation, using the cost inflation index).
    - Gold, international and fund-of-funds: units bought from 1 Apr 2023 and sold before 1 Apr 2025 at slab;
      otherwise as older debt. Hybrids with 35–65% equity: as older debt, whenever bought.
    - How a scheme is taxed comes from its AMFI category (and the name, for index funds, ETFs and funds of funds).
      When the category doesn't settle it (multi-asset, solution-oriented), the report says "please check".
  - Named on the report: sales in schemes not matched yet (left out), entries waiting for units, sales of more
    units than there are purchases for, and a missing 31 Jan 2018 NAV.
  - **Download CSV**: one row per piece of each sale, with purchase cost, cost used and indexed cost.
  - Losses are set off only within the same kind here; the tax return allows more. Sales before 1 Apr 2017 aren't
    covered.

- **Branded PDF statement** for one client or one family: **PDF statement** on their page (**Share PDF** on a
  phone).
  - Contents: current value, invested, gain and XIRR (or plain return); every holding; schemes not valued yet;
    active and paused SIPs; transactions of the last 12 months. In a family, each row says whose it is.
  - Branding: the practice's name, ARN and EUIN (Settings → Practice) in an olive band on top. The AMFI disclaimer
    ("Mutual Fund investments are subject to market risks, read all scheme related documents carefully.") and
    page numbers are on every page.
  - Made in the browser with pdf-lib (`src/lib/statement-pdf.ts`). The library is a separate file (about 180 KB
    compressed), fetched only on the first press, so pages don't get heavier.
  - On a phone or tablet the PDF goes to the share sheet (Web Share API), so it can go straight to WhatsApp. On
    a computer it downloads.
  - The built-in PDF font has no ₹ sign, so amounts read "Rs 1,23,456". Names in other scripts (e.g. Hindi)
    show as "?" for now; a Hindi statement needs an embedded font.

- **Client portal** (read-only). Families → **Client portal** (`/app/portal`), owners and staff.
  - The owner turns it on and gets the practice's link, `<site>/c/<code>`, to copy or share on WhatsApp. A client's
    page can also email that client the link. Turning it off signs every client out at once and the link stops
    working.
  - The client opens the link (branded with the practice's name, ARN and EUIN, and the AMFI disclaimer), enters
    the email on their client record and gets a **6-digit code** by email. SMS can come later.
  - They see their own and their family's portfolio: value, invested, gain, XIRR, holdings, SIPs, the last 12
    months, and the same PDF statement. Nothing can be changed. No PAN, bank or nominee details are shown.
  - **Who sees what:** the clients with that email, and everyone in their family. Worked out again on every page,
    so a changed email or family applies at once. An email that's on clients of different families can't sign in
    at all; the portal page lists such emails so they can be fixed.
  - **Protections:**
    - A separate session type (table `portal_sessions`, cookie `__Host-folio_portal`): a portal session never opens
      a team page. Sessions end after 3 days idle or 14 days in total.
    - Codes are stored only as an HMAC, work for 10 minutes, once, with 5 tries; asking again replaces the code.
    - Rate limits: 3 codes per email per 15 minutes (10 a day), 10 per network; 10 code entries per email and 30
      per network every 15 minutes.
    - Answers never say whether an email is on the records.
    - **Database wall** (migration 0011): portal requests run as their own role, `folio_portal`, scoped by
      `app.investor_ids`. It may only read, only those clients' rows, and on `investors` only the id, name and
      family columns; it can't read encrypted details, notes or any account table. `test/portal.test.ts` proves
      a client can't see another client's or another practice's rows, nor change anything.
  - Email must be working (SES) for clients to get codes; the portal page warns when it isn't.

```sh
npx tsx scripts/e2e-families.ts     # browser test: families (needs NAVs: npx tsx scripts/nav-import.ts)
npx tsx scripts/e2e-gains.ts        # browser test: capital gains (also needs internet, for mfapi.in)
npx tsx scripts/e2e-statement.ts    # browser test: PDF statement (download, phone share, lazy loading)
npx tsx scripts/e2e-portal.ts       # browser test: client portal (codes come from /dev/outbox)
```

## Look and feel

Same design language as Anqulas Docs:
- **Colours and type.** Bone paper, olive ink and bronze; Source Serif for headlines and big figures, Inter for
  everything else. Both fonts are self-hosted, so no visitor's browser calls Google.
- **Motion, all in CSS.** Headlines rise out of a mask and content fades up in a stagger. Rows fill with ink on
  hover, and figures count up on the first visit. Repeat visits get shorter versions, and the motion is off for
  people who ask for less.
- **Light and dark.** Chosen from the sidebar or Settings → Practice → Appearance, or following the device. The
  sidebar and the value panel stay olive in both themes.

Tokens and motion utilities live in `src/styles.css`; components in `src/components/ui.tsx`.

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
- **Not on Pages:** scheduled jobs. The `folio-mail` Worker's 30-minute tick stands in for them (phase 3 above);
  without it, the NAV import and the briefing still run in the background after page requests.

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

From the app, no secrets needed:

1. **Nothing to export by hand.** The Import page reads the old app's database itself (next steps).
2. **Create his account.** Your father signs up at folio.anqulas.com with his own email.
3. **Make his practice free of charge.** You (platform admin) open `/platform` → his practice → Manage →
   **Make free of charge**. Without this, his trial's client limit (750) still applies, and the trial ends after
   30 days.
4. **Import.** Signed in as him: Import → **Old FundVault app**.
   - Enter his **old app** email and password → **Get his data**. The browser reads the clients, investments and
     SIPs straight from the old app's database (`src/lib/imports/old-app.ts`); the password isn't kept.
   - If he signs in to the old app with Google: open "He signs in with Google?" for a copy-paste script that
     downloads the three CSV files from the old app's page, then choose those files.
   - Then press **Check (saves nothing)**.
   - It shows what comes over and compares the total invested and the active SIPs with the old app.
   - When it says "The totals match the old app", press **Import into Folio**.
   - Running it again never doubles anything.
5. **After the import:**
   - Scheme names that exactly match an AMFI scheme are linked at once; match the rest under Match schemes.
   - Importing his CAMS / KFintech reports then replaces the typed entries with the registrar's exact ones.
6. **Keep the old app** alongside for a few weeks. Delete the CSV files from your computer once done: they contain
   PANs and bank details.

Nothing touches the old app or its database. `scripts/import-fundvault.ts` does the same from a terminal, if ever
needed.
