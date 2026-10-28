# Anqulas Folio — SaaS plan (formerly FundBuddy)

Status: proposal, 26 Oct 2026. Nothing here is built yet. Decisions still open are listed at the end.

Goal: turn FundBuddy (today a single-advisor app built in Lovable) into a multi-advisor SaaS for
Indian mutual fund distributors (MFDs), at the quality level of Anqulas Docs (Docchase). It should cost about
₹500 a month for a small advisor. It must stay simple enough for a 60-year-old MFD to use, and its data model
must not block international use later.

---

## 0. Fix today, before anything else (about 15 minutes)

**Your father's clients' data can be read by anyone who creates an account.**

- `/auth` has an open "Create account" tab, and Google sign-in also creates accounts.
- Every data table's row-level security policy is `USING (true)` for any signed-in user
  (`supabase/migrations/20260816093833_…sql`).
- So a stranger who signs up at fundbuddy-pro.pages.dev sees every client's PAN, mobile, address, bank
  account number, IFSC and nominee details, and can edit or delete them.

Fix, in Lovable's **Cloud** tab (or the Supabase dashboard if you have it):

1. **Authentication settings:** turn off "Allow new users to sign up".
2. **SQL editor:** run the following. Use your father's user id from step (a), and add your own id too if you
   use the app.

```sql
-- (a) see who has accounts; delete any you don't recognise in Authentication -> Users
select id, email, created_at from auth.users order by created_at;

-- (b) make the real owners admins
insert into public.user_roles (user_id, role) values ('<FATHER_USER_ID>', 'admin') on conflict do nothing;

-- (c) only admins can read or change data
drop policy "Advisors manage clients"     on public.clients;
drop policy "Advisors manage investments" on public.investments;
drop policy "Advisors manage sips"        on public.sips;
create policy "Admins manage clients"     on public.clients     for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins manage investments" on public.investments for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins manage sips"        on public.sips        for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
```

Smaller items:

- `android/app/sideload.keystore` is committed with the password `android`. If the repo is public, anyone can
  sign an "update" of the app. The new app will use a private key held only in GitHub secrets.
- The first migration seeds four fake clients (Rahul Sharma and others). Check they are not mixed in with real ones.

---

## 1. A separate project, built fresh

Anqulas Folio is its own product. It lives in `folio/` in this repo, and has its own database, Cloudflare Worker,
subdomain (`folio.anqulas.com`), users and billing. Nothing is shared with Anqulas Docs (Docchase) at runtime, and a change in one never affects the other.

What it takes from Docchase is **lessons, not code links**. Docchase has already solved these problems, so
Folio repeats the same designs, written fresh for Folio's stack:

- Database-enforced separation between customers (row-level security)
- Two-step sign-in (optional per person, or required by the practice owner) and login lockouts
- Prepaid plans with a UPI / PhonePe checkout, and a platform admin console
- Append-only audit log
- The security mistakes listed in Docchase's `docs/research/security-legal-cost-review.md`, avoided from day one

Most of Docchase's code would not run unchanged anyway. It is built for a Node.js server, and Folio runs on
Cloudflare Workers (section 5). Where a small, self-contained piece fits as-is (for example Indian financial-year
date helpers, or CSV formula-injection guards), it is copied once into Folio and owned by Folio from then on.

The current Lovable app keeps running for your father, locked down (section 0), until the new one replaces it.

---

## 2. Multi-tenancy: "each advisor's database separate"

Three ways to keep one advisor's data away from another's:

| Option | Isolation | Cost at 100 advisors | Effort and risk |
|---|---|---|---|
| **A. One Postgres, every row tagged with its practice, enforced by row-level security** (Docchase's model) | The database refuses another practice's rows, even if app code has a bug | Lowest: one DB | Proven in Docchase |
| B. One Postgres, a separate schema per practice | Strong | Same server, but migrations run N times | Medium |
| C. A separate database per practice (e.g. one SQLite/D1 or Neon DB each) | Strongest | Rises with every advisor; shared NAV data copied N times | Every migration, backup and report fans out to N databases. Cross-practice work becomes hard (scheme master, NAVs, your MRR) |

**Recommendation: A, plus three extras that give most of C's benefit:**

1. **Per-practice encryption key** for PAN, Aadhaar, bank account and nominee details. Each key is wrapped by a
   master key. A leaked database dump is unreadable without the keys. Search works through a keyed hash, so you
   can still find a client by PAN.
2. **Shared, non-private data lives apart.** This is the scheme master, daily NAVs and AMC list, in their own
   tables, which nobody "owns". Only advisors' client data is tenant-scoped.
3. **"Export my whole practice"** (ZIP of CSVs + PDFs) and **"delete my practice"**, so any advisor can leave
   cleanly. DPDP Act requires this anyway.

A large distributor who insists on a physically separate database can later get a paid "Dedicated" add-on
(their own Postgres). The code is the same, only the connection string differs.

Your father's data: a new database, with your father as practice #1 (never billed). Section 7 covers the migration.

---

## 3. The core engine (what makes it worth ₹500/month)

This is the OFA-style loop: **registrar emails come in, transactions update, the NAV refreshes overnight, and the
advisor wakes up to correct values.**

### 3.1 Registrar mailback auto-import

CAMS and KFintech email distributors their "mailback" reports. Examples:

- CAMS: WBR2 (transactions) and the folio/holding reports.
- KFintech: MFSD201 (transactions) and similar.

They arrive as password-protected ZIP files (DBF, XLS or CSV inside), with a password the distributor sets.

How Folio receives them, cheapest and safest first:

1. **Forwarding address (recommended).** Every practice gets a private address like
   `mb-7f3k9q@in.folio.anqulas.com`. The advisor adds one Gmail/Outlook filter: "from CAMS or KFintech → forward".
   - Mail arrives through **Cloudflare Email Routing → Email Worker** (free). The raw mail goes to storage and a
     row goes to `ingest_messages`.
   - Gmail sends a confirmation code to new forwarding addresses. Folio shows that code in the app, so setup
     takes about 2 minutes.
   - Only mail from the registrars' real domains is accepted (SPF/DKIM checked). Everything else is dropped.
2. **Upload button.** The same parsers accept files dragged in by hand. This is the fallback, and also how
   history gets imported.
3. Not doing: reading the advisor's Gmail directly via the Gmail API. Google requires a paid yearly security
   assessment for that scope, and advisors are rightly wary of giving it.

Parsing rules:

- Every registrar transaction has a stable id. It is stored with a unique key per practice, so a re-sent or
  overlapping file never double-counts.
- New PAN → new investor. New folio → new folio, automatically.
- Anything unrecognised goes to a short **"Needs a look"** list. It never fails silently.

### 3.2 Daily NAV and valuation

- AMFI publishes every scheme's NAV daily, free (`NAVAll.txt`: scheme code, ISINs, name, NAV, date).
- A job at about 11:30 pm and again at 7 am stores NAVs for schemes that any practice holds, plus the scheme
  master (AMC, category, ISIN, plan, option).
- Then every holding is revalued. Each morning the advisor sees: current value, invested, gain, XIRR, and the
  day's change. Values are per scheme, folio, client and family.
- Weekends and holidays use the last NAV, labelled with its date. The NAV date is always shown.
- **As built:** Cloudflare Pages has no cron, so the import runs in the background after a page request once
  the last one is 6 hours old. Every scheme's latest NAV is kept; day-by-day history only for schemes in use
  (backfilled from mfapi.in). That keeps the database small enough for Supabase Free.

### 3.3 Client CAS import (onboarding in one step)

- The client downloads their CAS PDF from MF Central or CAMS. The password is their PAN.
- The advisor uploads it. Folio reads every folio, including other distributors' and direct plans, and builds
  the portfolio.
- Held-away folios are marked as such. This is the fastest way to bring a new client on board.

### 3.4 Families

- Group clients into a family with a head. Reports, values and statements work per family.
- Indian MFDs work this way; one family is often 4–8 PANs.

---

## 4. Features

Rule for every feature: it must work without training, show up only when it has something to say, and fit in the
five-item menu **Home · Clients · SIPs · Reports · Settings**.

### v1 — launch (needed to charge)

1. **Morning briefing** on Home, and the same summary on WhatsApp or email at 8 am. Example:
   "Book ₹4.82 Cr (+0.6%). Yesterday: 14 SIPs processed, **2 bounced** (Rahul, Sneha: call them), 1 redemption
   ₹2.1 L (Amit), 3 SIPs end this month, 2 birthdays."
2. **Mailback auto-import + daily NAV + valuation + XIRR** (section 3).
3. **SIP book.** SIPs are detected from transactions, not typed in. Each has a status: Active, Bounced, Paused,
   Ending soon, Stopped. Plus monthly SIP inflow and its trend.
4. **Clients & families.** Your father's current client form, plus KYC status, nominee status, risk profile and
   notes. Search by name, PAN, mobile or folio.
5. **Branded client report (PDF).** One tap to share on WhatsApp. It carries the advisor's name, logo, ARN and
   EUIN, and the AMFI disclaimer. Available in English and Hindi.
6. **Auto monthly statement.** On the 1st, every client gets their family statement by email or WhatsApp. This
   can be switched off per client.
7. **Client app / portal.** The client logs in with a mobile OTP and sees their family portfolio, branded as the
   advisor's. Read-only. This is the feature advisors show their clients.
8. **Capital gains report per financial year.** FIFO, short and long term, using current Indian rules (equity LTCG
   12.5% above ₹1.25 L, STCG 20%, grandfathering at 31 Jan 2018, debt funds bought after 1 Apr 2023 taxed at slab).
   Rules are kept in one versioned table, so a Budget change is a one-line update.
9. **Staff and sub-brokers.** The owner sees everything; a sub-broker sees only their own clients,
   enforced by the database.
10. **Security from day one.** Optional authenticator (owner can require it), encrypted PAN and bank details, audit log, database in India.

### v2 — the "wow" features (after 5–10 paying advisors)

11. **Opportunity radar.** One list on Home, each item one tap to call or WhatsApp:
    - SIP stopped or bounced in the last 60 days
    - Big redemption (follow up)
    - Folios with no nominee
    - Missing email or mobile
    - KYC not validated
    - Idle money: a client redeemed and has not reinvested
12. **Tax harvesting (January to March).** "These 23 clients can book up to ₹1.25 L of gains tax-free before
    31 March." One tap sends each client their own number. This is an obvious reason for advisors to pay.
13. **Trail commission tracking.** Import AMC brokerage files. See income per month and per AMC, a projected yearly
    trail, and missing-brokerage flags.
14. **Birthday and anniversary wishes** via WhatsApp, automatic and approved once.
15. **Shareable calculators** (SIP, step-up, goal, retirement) with the advisor's branding, for WhatsApp status and
    lead capture. A lead lands in Clients.
16. **Ask Folio (AI).** An MCP connector (the same idea Anqulas Docs uses, built separately). The advisor asks Claude "whose SIPs bounced this
    month?" or "draft a message to the Verma family about their gains". It runs on the advisor's own Claude
    account, so it costs us nothing.
17. **Other assets, typed in by hand** (FDs, insurance, PPF, stocks, as values only), for a net-worth view.

### Later (only if advisors ask)

- **Placing orders** through BSE StAR MF, NSE NMF II or MF Utility: SIP registration, e-mandate, lumpsum. This is
  powerful, but each advisor needs their own exchange membership credentials, and it adds compliance work. Build it
  once there is demand.
- **RIA mode** (fee billing, risk profiling, advice records) for SEBI-registered advisers.
- **International mode** (section 6).

### Deliberately not building

- Fund ratings, "buy this fund" recommendations or model portfolios. An MFD is not a SEBI-registered investment
  adviser, and recommendation features create regulatory risk for them and for you.
- A full CRM pipeline, social-media poster libraries, stock trading, or complex financial-planning suites. Other
  products do these badly and they confuse the target user.

---

## 5. Environment: Cloudflare Workers + Postgres in Mumbai

Requirement: nothing should strain or need re-architecting as advisors, clients and data grow, at the lowest
running cost.

### The setup

| Part | Service | What it does | Grows how |
|---|---|---|---|
| App server + API | **Cloudflare Workers** (Paid plan, $5/month) | Web app, client app, API. Runs in Cloudflare's data centres nearest the user | Automatically, with no servers to size or patch |
| Database | **Supabase Postgres, Mumbai** (Free plan to start), used only as plain Postgres from the server | All advisor and client data, with row-level security per practice | Supabase Pro, or move to PlanetScale HA (Mumbai) by changing one connection setting |
| DB connection | **Cloudflare Hyperdrive** (included in Workers Paid) | Pools and reuses database connections, so thousands of requests do not open thousands of connections | Built in |
| Scheduled jobs | **Cron Triggers** | Nightly NAV import, morning briefing, monthly statements | Built in; up to 15 min CPU per run |
| Background work | **Cloudflare Queues** | Each mailback file, CAS PDF or statement is one job, retried on failure. One bad file never blocks others | Spreads out automatically |
| Inbound mailback | **Cloudflare Email Routing + Email Worker** | Receives forwarded CAMS/KFintech mails at each practice's private address | Built in, free |
| Files | **Cloudflare R2** | Raw mails, CAS PDFs, generated statements (encrypted, private) | 10 GB free, then about $0.015/GB; no download fees |
| Outbound email | **Amazon SES (Mumbai)** | Sign-up mails, statements, briefings | About $0.10 per 1,000 |
| WhatsApp | Advisor's own WhatsApp Business number | Briefings, statements, wishes | Meta bills the advisor |
| Monitoring | Workers logs + Sentry free tier | Errors and failed jobs reported, not silent | |

Code stack: **TypeScript, TanStack Start** (what the old FundBuddy app already uses, and it deploys to Workers), **Drizzle ORM**
(small and Workers-friendly) and **Postgres row-level security**. GitHub Actions deploys `main` automatically, as today.

### Cost

| Stage | Database | Approx. total / month |
|---|---|---|
| Building + father + free beta | Supabase Free, Mumbai ($0) + Workers Paid ($5) | **~$5 (~₹450)** |
| First paying advisor onward | Supabase Pro, Mumbai ($25, daily backups) **or** PlanetScale HA, Mumbai (~$30, automatic failover) + Workers $5 + SES | **~$30–40 (~₹2,700–3,500)** |
| ~500 advisors | Larger HA node + Workers usage beyond included limits | roughly ₹8,000–12,000 (still under 5% of revenue) |

Workers Paid includes 10 million requests and 30 million CPU-milliseconds a month. That is far more than hundreds
of advisors use. Prices are from Cloudflare's and PlanetScale's pages and announcements as of Oct 2026; check the
Mumbai price on the PlanetScale calculator before creating the database.

### Why Supabase Free first

- Best free plan with a **Mumbai** server. Neon and Aiven have no India region; PlanetScale has no free plan.
- **Limits and how we handle them:**
  - 500 MB of data: enough for your father plus a free beta of 10–20 advisors.
  - No backups on Free: our own nightly encrypted `pg_dump` to R2 covers this from day one.
  - Pauses after 7 days of no activity: the nightly NAV job queries it every day, so it never pauses.
- **The Feb 2026 ISP block does not affect this design.** Browsers never contact `supabase.co`; only Cloudflare's
  servers do, through Hyperdrive. Supabase's Data API is switched off and the `anon`/`authenticated` grants are
  revoked (the Anqulas Docs lesson).
- Upgrade before the first paying advisor. Supabase Pro adds daily backups; PlanetScale HA adds automatic failover.
  Same code either way.

### Why this beats the alternatives

- **vs. a single server (DigitalOcean / Lightsail):** no server to patch and nothing to resize when load jumps on
  the 1st of the month. DigitalOcean also has no free database plan: managed Postgres starts at $15/month, and new
  accounts may now get only $5 of credit.
- **vs. Cloudflare D1 (Cloudflare's own database):** D1 is SQLite, has no India location (only "Asia-Pacific", or
  EU/FedRAMP jurisdictions) and caps the size of each database. Postgres in Mumbai keeps client data in India, and
  gives row-level security and room to grow.
- **No lock-in:** it is standard Postgres, so the database can move to AWS or DigitalOcean by changing one connection
  setting.

### Limits to design around (already planned for)

- A Worker has about 128 MB of memory. Mailback ZIPs and CAS PDFs are a few MB, so this is fine. Each file is
  handled as its own queued job, and never all at once. If a very large file ever appears, Cloudflare Containers is
  the escape hatch, with no redesign.
- Native Node libraries do not run on Workers. Password hashing uses a WebAssembly Argon2, and ZIP files with
  passwords use a pure-JS library.
- Data at rest: the database is in Mumbai. R2 files are in Cloudflare's Asia-Pacific region (no India-only option
  today). The public wording will say exactly that.

### Backups

- The database provider's automatic backups (Supabase Pro or PlanetScale, once on a paid plan).
- **Plus our own nightly encrypted `pg_dump`** to R2, made by a scheduled GitHub Action and kept 30 days.
- A restore drill once a month, so a backup is known to work before it is needed.

### Fixed costs

- Domain: about ₹1,200 a year.
- Before taking money: register a Pvt Ltd company, and decide GST with your CA.
- Data size is small. A large advisor (1,000 clients, 10 years) is about 1 million transactions, roughly 300 MB.

### Pricing suggestion

| Plan | Clients (PANs) | Users | ₹ / month | ₹ / year |
|---|---|---|---|---|
| Starter | 200 | 1 | **499** | 4,990 |
| Growth | 750 | 3 | 999 | 9,990 |
| Pro | Unlimited | 10 | 1,999 | 19,990 |

- 30-day free trial.
- Founding offer: Growth at ₹499 for the first 50 advisors, locked for 2 years.
- Hosting is about ₹3,000–3,500 once paid plans start, so **about 7 paying advisors cover it.** At 100 advisors (around ₹70,000 MRR), hosting is
  under 10%.
- Comparable Indian back-office tools sell at ₹100 per user per month at the low end, and much higher for full
  suites. ₹499 for automatic mailback import, a branded client app and WhatsApp statements is easy to say yes to.

---

## 6. International scope (designed in, not built)

- The model uses **instruments**, not just "schemes": asset type (mutual fund, ETF, stock, bond, FD, other),
  currency and country. India's AMFI is one **price source plugin**; others can be added later.
- Money is stored with its currency. Number formatting follows the practice's locale (lakh/crore or million).
- Tax rules are a per-country module. India is first; other countries show "gains" without tax until added.
- Identity is "tax id" with a type (PAN for India), not a hard-coded `pan` column.
- Plans carry a `$` price from the start.

---

## 7. Data model (first cut) and father's data migration

Shared (not tenant-scoped): `amcs`, `instruments` (AMFI code, ISINs, name, category, plan/option), `nav_prices`
(instrument, date, nav).

Per practice (RLS):

| Table | Notes |
|---|---|
| `practices` | Name, ARN, EUIN, logo, locale, plan |
| `users`, `memberships` | Role owner/staff/sub-broker |
| `families` | |
| `investors` | Encrypted tax id + hash, contacts, KYC, nominee |
| `folios` | AMC, folio no, investor, held-away flag |
| `transactions` | Folio, instrument, type, units, NAV, amount, date, source, registrar txn id **unique per practice** |
| `holdings` | Derived, refreshed after imports and NAV |
| `sips` | Derived from transactions + manual |
| `ingest_messages`, `import_issues` | Raw mail/file pointer, status, "needs a look" |
| `brokerage` | v2 |
| `notes`, `audit_log` | |

Father's data migration:

1. Export `clients`, `investments` and `sips` from the current project. Use CSV export, or a one-off script with the
   service key that runs only on your machine.
2. Import as practice #1:
   - Each client becomes an investor; families are suggested by shared address or surname, and he confirms.
   - Free-text scheme names are fuzzy-matched to AMFI schemes, with a one-page "confirm these matches" screen.
3. Connect his mailback and import full history from the registrars, then reconcile against the hand-typed entries
   (duplicates flagged, not merged blindly).
4. Run both apps side by side for 2–4 weeks. Switch when the numbers match his registrar statements. Keep the old
   project read-only for 90 days.

---

## 8. Build order

| Phase | Delivers | Rough size |
|---|---|---|
| 0 | Lock down current app (section 0) | 15 min, today |
| 1 | Environment (Cloudflare Workers + Postgres in Mumbai + Hyperdrive + CI), sign-up, optional authenticator + recovery codes, password reset, practices + RLS, encryption, team and sub-brokers, UPI billing, platform console, father's data import. **Done**: see `folio/README.md` | 2 weeks |
| 2 | Scheme master + daily NAV, valuation, XIRR; CAMS/KFintech file parsers (upload); CAS PDF import. **Done**: see `folio/README.md`. Still to check against real files | 2 weeks |
| 3 | Forwarding address + automatic ingest; SIP book; morning briefing (app + WhatsApp/email) | 1–2 weeks |
| 4 | Families; branded PDF reports, monthly auto-statements, client portal (OTP), capital gains. **In progress** on `claude/folio-phase4`: families and capital gains done | 2 weeks |
| — | **Beta with father + 5–10 MFDs he knows** | |
| 5 | v2: opportunity radar, tax harvesting, brokerage, AI connector | as demand shows |

**Needed from you to start phase 2:** sample mailback files from your father's ARN. One recent CAMS transaction file
and one KFintech file (with the ZIP password), plus one CAS PDF. Real formats differ from published descriptions,
and parsers must be built against real files. Names and PANs can be masked.

---

## Decisions

1. Isolation: one shared Postgres with row-level security and per-practice encryption. **Decided.**
2. Environment: Cloudflare Workers + Supabase Free in Mumbai, upgraded at the first paying advisor. **Decided.**
3. Name: **Anqulas Folio**, at `folio.anqulas.com`, built in `folio/` of this repo. **Decided.**
4. Open: does your father hold an ARN, and does he get CAMS and KFintech mailback emails today?
