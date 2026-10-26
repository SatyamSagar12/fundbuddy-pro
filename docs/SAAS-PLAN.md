# FundBuddy Pro — SaaS plan

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

## 1. What to build on

**Recommendation: build the new FundBuddy on the Docchase codebase.**

Do not keep extending the Lovable/TanStack app.

Docchase already has the hard, boring SaaS parts, tested and reviewed. FundBuddy would otherwise rebuild all of it:

| Needed for FundBuddy SaaS | Already in Docchase |
|---|---|
| Sign-up, email verification, trial | `services/signup.ts` |
| Mandatory 2FA, passkeys, new-device alerts, lockouts | `staff-mfa.ts`, `passkeys.ts`, `security-alerts.ts` |
| Tenant isolation enforced by Postgres row-level security | `src/server/db-scope.ts` + RLS migrations |
| Staff roles, "only my clients" for staff | `staff-access.ts` (maps directly to MFD sub-brokers) |
| Plans, limits, UPI / PhonePe / PayPal, billing lock | `plans.ts`, `billing.ts`, `payments/` |
| Platform admin console (your view of all advisors) | `/platform` |
| Email, WhatsApp (advisor's own number), push, Android app | `mailer.ts`, `whatsapp*.ts`, `push.ts`, `mobile/` |
| Hindi for client-facing text | `src/lib/i18n` |
| Client portal with its own login + 2FA | `client-accounts.ts` |
| Append-only audit log, retention, backups | `activity-*.ts`, `retention.ts`, `scripts/backup.sh` |
| AI connector (ask Claude about your book) | `docs/CONNECTOR.md` |
| Lessons already learned (Data API lock, cron double-send, etc.) | `docs/research/security-legal-cost-review.md` |

Plan: create a fresh repo (or a fresh `main` in `fundbuddy-pro`) from Docchase's platform layer. Then remove the
CA-specific parts (document requests, GST, Tally, DSC, compliance) and add the mutual fund engine described below.
Stack: Next.js 16, React 19, Prisma 7, Postgres 17.

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

How FundBuddy receives them, cheapest and safest first:

1. **Forwarding address (recommended).** Every practice gets a private address like
   `mb-7f3k9q@in.fundbuddy.app`. The advisor adds one Gmail/Outlook filter: "from CAMS or KFintech → forward".
   - Mail arrives through **Cloudflare Email Routing → Email Worker** (free). The raw mail goes to storage and a
     row goes to `ingest_messages`.
   - Gmail sends a confirmation code to new forwarding addresses. FundBuddy shows that code in the app, so setup
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

### 3.3 Client CAS import (onboarding in one step)

- The client downloads their CAS PDF from MF Central or CAMS. The password is their PAN.
- The advisor uploads it. FundBuddy reads every folio, including other distributors' and direct plans, and builds
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
   Rules are kept in one versioned table, as Docchase does with due dates.
9. **Staff and sub-brokers.** The owner sees everything; a sub-broker sees only their own clients. This reuses
   Docchase staff access.
10. **Security as in Docchase.** Mandatory 2FA, encrypted PAN and bank details, audit log, India-only data.

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
16. **Ask FundBuddy (AI).** Uses Docchase's MCP connector pattern. The advisor asks Claude "whose SIPs bounced this
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

## 5. Hosting and cost (cheapest without cutting safety)

The workload is mostly background work: parsing mail, the nightly NAV import and revaluing holdings. A small
always-on server suits it better than serverless functions, which have time limits and few cron jobs.

| Stage | Setup | Approx. ₹/month |
|---|---|---|
| Building + father only | Local dev; current Lovable app keeps running (locked down) | 0 |
| Beta → ~100 advisors | **DigitalOcean Bangalore:** one small server (Droplet, 2 GB, ~$12) for app + worker, plus **Managed Postgres** (~$15, daily backups + 7-day point-in-time recovery included, same data centre). **Cloudflare** in front (free). **Cloudflare R2** for PDFs and raw mails (free up to 10 GB). Extra nightly **encrypted `pg_dump` to R2**, kept 30 days, with a monthly restore test. **Amazon SES Mumbai** for email (about ₹9 per 1,000). **Cloudflare Email Routing** for inbound mail (free). Sentry and Better Stack free tiers. | **~₹2,400** |
| 100+ advisors | Bigger Droplet and database plan; add a standby database node for automatic failover | ~₹5,000–7,000 |

### Database: why not Supabase

The new app talks to the database only from the server, and does its own sign-in (Docchase's). So it needs
**plain Postgres** and none of Supabase's extras. Any provider below works with the same code; moving later only
changes the connection string.

| Option | India region | Approx. cost | Backups | Verdict |
|---|---|---|---|---|
| **DigitalOcean Managed Postgres** | Bangalore | ~$15 (~₹1,300) | Daily + 7-day point-in-time recovery included | **Recommended.** Cheapest managed option with recovery included, next to the app server |
| PlanetScale Postgres (PS-5) | Mumbai | ~$5 (~₹450) single node; ~$30 with failover | Included | Good cheaper alternative; confirm the Mumbai price and backup terms before choosing |
| Postgres on the same server (Docker) | Wherever the server is | ₹0 extra | Only what we script (`pg_dump`, or WAL-G to R2 for point-in-time) | Cheapest; you become the database admin. Fine while it is only father's data |
| AWS RDS / Lightsail database | Mumbai | ~$15+ | Included | Fine, more AWS complexity |
| Supabase Pro | Mumbai | $25 (~₹2,200); point-in-time recovery +$100/month | Daily (7 days) | Pays for auth, storage and APIs we would not use. Indian ISPs blocked `supabase.co` under Section 69A in Feb 2026 (later restored); a repeat would hit apps that use it from the browser |
| Neon | No (Singapore nearest) | Usage-based | Included | Data leaves India and every query is slower. No |
| Nile (Postgres with built-in "database per tenant") | Not confirmed | Unpublished | — | Interesting for the per-advisor wish, but too young and unclear for client financial data. Revisit later |

Zero-ops alternative: Vercel Pro + DigitalOcean Managed Postgres. No server patching, but the mail and NAV jobs
would still need a small worker.

Notes:

- **WhatsApp:** each advisor connects their own WhatsApp Business number, and Meta bills them directly (the
  Docchase model). Platform cost is ₹0.
- **Data size is small.** A large advisor (1,000 clients, 10 years) is about 1 million transactions, roughly
  300 MB. Storing NAVs only for held schemes keeps the shared tables to a few hundred MB per year.
- **Fixed costs:** domain about ₹1,200 a year. Before taking money, register a Pvt Ltd company and decide GST with
  your CA, as the Docchase review already says.
- Check provider prices on their official pages before buying; they change.

### Pricing suggestion

| Plan | Clients (PANs) | Users | ₹ / month | ₹ / year |
|---|---|---|---|---|
| Starter | 200 | 1 | **499** | 4,990 |
| Growth | 750 | 3 | 999 | 9,990 |
| Pro | Unlimited | 10 | 1,999 | 19,990 |

- 30-day free trial.
- Founding offer: Growth at ₹499 for the first 50 advisors, locked for 2 years. This reuses Docchase's founding code.
- Hosting is about ₹2,500, so **5 paying advisors cover it.** At 100 advisors (around ₹70,000 MRR), hosting is
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
- Pricing already has a `$` column (as in Docchase's plans).

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
| 1 | New app from Docchase platform layer: signup, 2FA, practices + RLS, staff roles, billing, platform console; father's data migrated | 1–2 weeks |
| 2 | Scheme master + daily NAV, valuation, XIRR; CAMS/KFintech file parsers (upload); CAS PDF import | 2 weeks |
| 3 | Forwarding address + automatic ingest; SIP book; morning briefing (app + WhatsApp/email) | 1–2 weeks |
| 4 | Branded PDF reports, monthly auto-statements, client portal (OTP), capital gains | 2 weeks |
| — | **Beta with father + 5–10 MFDs he knows** | |
| 5 | v2: opportunity radar, tax harvesting, brokerage, AI connector | as demand shows |

**Needed from you to start phase 2:** sample mailback files from your father's ARN. One recent CAMS transaction file
and one KFintech file (with the ZIP password), plus one CAS PDF. Real formats differ from published descriptions,
and parsers must be built against real files. Names and PANs can be masked.

---

## Open decisions

1. Isolation: shared Postgres + RLS + per-practice encryption (recommended), or a separate database per advisor?
2. Build on the Docchase codebase (recommended), or keep the Lovable/TanStack app?
3. Hosting: DigitalOcean Bangalore server + Managed Postgres (~₹2,400/month, recommended), PlanetScale Mumbai database (cheaper, verify terms), or Postgres on the server itself (cheapest, you look after it)?
4. Product name and domain. Is "FundBuddy" final? It is needed for the forwarding addresses and branding.
5. Does your father hold an ARN as an individual MFD, and does he use CAMS and KFintech mailback today?
