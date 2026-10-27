/**
 * Database tables.
 *
 * Three groups:
 *  - Accounts (practices, users, memberships, sessions, tokens, rate limits): read and written only by the
 *    server's own sign-in code, never from a practice-scoped transaction.
 *  - Shared market data (instruments, NAVs): the same for every practice, owned by nobody.
 *  - Practice data (everything with `practice_id`): row-level security in migration 0001 makes the database
 *    refuse any row whose practice is not the one set for the current transaction (see ./scope.ts).
 *
 * Sensitive identity fields (tax id, bank, nominee) are stored only encrypted, with the practice's own key
 * (see ../crypto.ts). `tax_id_hash` is a keyed hash so a client can be found by PAN without decrypting.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ── Accounts ──────────────────────────────────────────────────────────────────

export const practices = pgTable("practices", {
  id: id(),
  name: text("name").notNull(),
  arn: text("arn"),
  euin: text("euin"),
  country: char("country", { length: 2 }).notNull().default("IN"),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  locale: text("locale").notNull().default("en-IN"),
  plan: text("plan").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  paidUntil: timestamp("paid_until", { withTimezone: true }),
  /** Never charged, never locked (your father's practice, demo practices). */
  billingExempt: boolean("billing_exempt").notNull().default(false),
  /** This practice's data key, encrypted with the master key. */
  dataKeyWrapped: text("data_key_wrapped").notNull(),
  status: text("status").notNull().default("active"),
  /** The owner can make an authenticator app compulsory for everyone in the practice. Off by default. */
  requireTotp: boolean("require_totp").notNull().default(false),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    /** Stored lower-case; unique across all practices so sign-in needs no practice picker. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** Authenticator secret, encrypted with the master key. Null until set up. */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    /** Last accepted 30-second step, so a code can never be used twice. */
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** owner | staff | subbroker */
    role: text("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_practice_user_key").on(t.practiceId, t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** HMAC of the cookie token; the token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    practiceId: uuid("practice_id").references(() => practices.id, { onDelete: "cascade" }),
    /** True once the authenticator code was accepted for this session. */
    mfaPassed: boolean("mfa_passed").notNull().default(false),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const emailTokens = pgTable("email_tokens", {
  /** HMAC of the emailed token. */
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** verify | reset */
  purpose: text("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** One-time codes to get back in after losing the phone with the authenticator. Only HMACs are stored. */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recovery_codes_hash_key").on(t.codeHash), index("recovery_codes_user_idx").on(t.userId)],
);

/** Invitations to join a practice. `id` is the HMAC of the emailed token. */
export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** staff | subbroker */
    role: text("role").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invites_practice_idx").on(t.practiceId)],
);

/** Payments for plans. Amounts are in paise (or cents), decided on the server from the plan table. */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(),
    months: integer("months").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    /** upi_manual | recorded (entered by the platform admin) */
    method: text("method").notNull(),
    /** UPI transaction reference (UTR), unique per method so one payment is claimed once. */
    reference: text("reference"),
    /** pending | confirmed | rejected */
    status: text("status").notNull().default("pending"),
    createdBy: uuid("created_by"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payments_method_reference_key").on(t.method, t.reference),
    index("payments_practice_idx").on(t.practiceId, t.createdAt),
  ],
);

// ── Shared market data ────────────────────────────────────────────────────────

export const instruments = pgTable(
  "instruments",
  {
    id: id(),
    /** mutual_fund for now; etf, stock, bond, fd later. */
    kind: text("kind").notNull().default("mutual_fund"),
    country: char("country", { length: 2 }).notNull().default("IN"),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    /** AMFI scheme code (India). Other countries get their own identifier columns when added. */
    amfiCode: text("amfi_code"),
    isin: text("isin"),
    isinReinvest: text("isin_reinvest"),
    name: text("name").notNull(),
    amc: text("amc"),
    category: text("category"),
    /** direct | regular */
    plan: text("plan"),
    /** growth | idcw_payout | idcw_reinvest */
    option: text("option"),
    active: boolean("active").notNull().default(true),
    /** "Open Ended", "Close Ended" or "Interval Fund", from the AMFI file. */
    schemeType: text("scheme_type"),
    /** Latest NAV from the daily AMFI file (every scheme). Day-by-day history is kept only for schemes in use. */
    latestNav: numeric("latest_nav", { precision: 18, scale: 6 }),
    latestNavDate: date("latest_nav_date"),
    /** NAV history is stored from this date on; null means the scheme isn't tracked yet (no client holds it). */
    historyFrom: date("history_from"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("instruments_amfi_code_key").on(t.amfiCode), index("instruments_isin_idx").on(t.isin)],
);

/** Small key/value state for system jobs (e.g. when NAVs were last imported). Owner only. */
export const marketState = pgTable("market_state", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: updatedAt(),
});

export const navPrices = pgTable(
  "nav_prices",
  {
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    nav: numeric("nav", { precision: 18, scale: 6 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.date] })],
);

// ── Practice data (row-level security) ────────────────────────────────────────

const practiceId = () =>
  uuid("practice_id")
    .notNull()
    .references(() => practices.id, { onDelete: "cascade" });

export const families = pgTable("families", {
  id: id(),
  practiceId: practiceId(),
  name: text("name").notNull(),
  headInvestorId: uuid("head_investor_id"),
  createdAt: createdAt(),
});

export const investors = pgTable(
  "investors",
  {
    id: id(),
    practiceId: practiceId(),
    familyId: uuid("family_id").references(() => families.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    mobile: text("mobile"),
    email: text("email"),
    dob: date("dob"),
    address: text("address"),
    /** PAN in India; a different type elsewhere. */
    taxIdType: text("tax_id_type").notNull().default("PAN"),
    taxIdEnc: text("tax_id_enc"),
    taxIdHash: text("tax_id_hash"),
    /** Last 4 characters, for display as XXXXXX234F. */
    taxIdLast4: text("tax_id_last4"),
    /** Encrypted JSON: account number, bank, IFSC, MICR, branch. */
    bankEnc: text("bank_enc"),
    /** Encrypted JSON: name, dob, PAN, mobile, email, relation. */
    nomineeEnc: text("nominee_enc"),
    kycStatus: text("kyc_status"),
    /** The staff member or sub-broker who looks after this client. */
    assignedUserId: uuid("assigned_user_id"),
    notes: text("notes"),
    /** Id in the old FundVault app, so the import can be re-run safely. */
    legacyId: text("legacy_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("investors_practice_idx").on(t.practiceId),
    index("investors_tax_id_hash_idx").on(t.practiceId, t.taxIdHash),
    uniqueIndex("investors_legacy_key").on(t.practiceId, t.legacyId),
  ],
);

export const folios = pgTable(
  "folios",
  {
    id: id(),
    practiceId: practiceId(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id, { onDelete: "cascade" }),
    amc: text("amc").notNull(),
    folioNo: text("folio_no").notNull(),
    /** Held through another distributor or direct; imported from a CAS for the full picture. */
    heldAway: boolean("held_away").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("folios_practice_amc_no_key").on(t.practiceId, t.amc, t.folioNo, t.investorId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    practiceId: practiceId(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id, { onDelete: "cascade" }),
    folioId: uuid("folio_id").references(() => folios.id, { onDelete: "set null" }),
    instrumentId: uuid("instrument_id").references(() => instruments.id),
    /** Scheme as typed or received, kept until matched to an instrument. */
    schemeText: text("scheme_text"),
    /** purchase | sip | redemption | switch_in | switch_out | idcw_reinvest | idcw_payout | other */
    type: text("type").notNull(),
    tradeDate: date("trade_date").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    units: numeric("units", { precision: 20, scale: 4 }),
    nav: numeric("nav", { precision: 18, scale: 6 }),
    /** Units worked out from the day's NAV (entered by hand). Registrar files give exact units instead. */
    unitsEstimated: boolean("units_estimated").notNull().default(false),
    paymentMode: text("payment_mode"),
    reference: text("reference"),
    /** manual | legacy | cams | kfintech | cas */
    source: text("source").notNull(),
    /** The registrar's own id (or legacy id), so re-sent files never double-count. */
    sourceTxnId: text("source_txn_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("transactions_investor_idx").on(t.practiceId, t.investorId, t.tradeDate),
    index("transactions_instrument_idx").on(t.instrumentId),
    uniqueIndex("transactions_source_key").on(t.practiceId, t.source, t.sourceTxnId),
  ],
);

export const sips = pgTable(
  "sips",
  {
    id: id(),
    practiceId: practiceId(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => investors.id, { onDelete: "cascade" }),
    folioId: uuid("folio_id").references(() => folios.id, { onDelete: "set null" }),
    instrumentId: uuid("instrument_id").references(() => instruments.id),
    schemeText: text("scheme_text"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** monthly | quarterly | weekly | daily */
    frequency: text("frequency").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    /** active | paused | stopped | ended */
    status: text("status").notNull(),
    source: text("source").notNull(),
    legacyId: text("legacy_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sips_practice_idx").on(t.practiceId, t.status),
    uniqueIndex("sips_legacy_key").on(t.practiceId, t.legacyId),
  ],
);

/** Append-only: the app role may insert and read its own practice's rows, never change or delete them. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    practiceId: uuid("practice_id").references(() => practices.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    target: text("target"),
    meta: jsonb("meta"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_practice_idx").on(t.practiceId, t.createdAt)],
);
