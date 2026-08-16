# FundFlow Manager

MASTER PROMPT — MUTUAL FUND CLIENT & INVESTMENT MANAGEMENT WEB APPLICATION

You are a senior full-stack SaaS architect and UI developer.

Build a simple, production-ready Mutual Fund Client & Investment Management Web Application.

This is NOT a static UI.

The application must have:

- Working frontend

- Working backend

- Real database connection

- Login system

- Client management

- Investment entry system

- SIP tracking

- Basic reports

- Clean UI

- Responsive design

Keep it lightweight and suitable for a free-tier Lovable project.

Avoid over-engineering.

---

1. PRODUCT NAME

Use a simple fintech name:

FundVault Lite

Subtitle:

Mutual Fund Management System

---

2. PRIMARY OBJECTIVE

The app helps a financial advisor manage:

- Clients

- Their mutual fund investments

- SIP records

- Basic reports

Users should be able to:

1. Add clients also able to add its nominee name,Dob,PAN, Mobile, Email Id linked to the particular client

2. View clients

3. Edit clients

4. Add investments

5. Add SIPs

6. View investment history

7. Search clients

8. View simple dashboard summary

---

3. TECH STACK

Use a simple modern stack:

Frontend:

- React

- Tailwind CSS

- Basic component library (optional)

Backend:

- Supabase (preferred for free tier)

Database:

- PostgreSQL (via Supabase)

Auth:

- Supabase Auth

No custom backend unless necessary.

---

4. USER ROLES

Keep it simple:

Admin

- Full access

User / Advisor

- Can manage clients and investments

---

5. AUTHENTICATION

Simple login system:

Pages:

- Login

- Logout

Protect dashboard routes.

No complex session logic needed.

---

6. MAIN LAYOUT

Simple dashboard layout:

Sidebar:

- Dashboard

- Clients

- Investments

- SIPs

- Reports

- Settings

Top bar:

- User profile

- Logout

Mobile responsive required.

---

7. DASHBOARD

Show basic stats (from database):

- Total Clients

- Total Investments

- Active SIPs

- Total Amount Invested

Add simple charts if easy (optional).

No complex analytics.

---

8. CLIENT MANAGEMENT 

Page: "/clients"

Table:

- Name

- Mobile

- Email

- PAN

- Actions

Actions:

- View

- Edit

- Delete

Features:

- Search by name or mobile

- Add new client form

---

9. ADD CLIENT FORM

Fields:

- Full Name

- Mobile Number

- Email

- Address

- PAN Number (basic format validation only)

Keep form simple and fast.

---

10. INVESTMENT MODULE

Page: "/investments"

Fields:

- Select Client

- Scheme Name (text input)

- Investment Type (SIP / One-time)

- Amount

- Date

- Payment Mode (Online / Cheque)

- Transaction ID

Save to database.

---

11. SIP MANAGEMENT

Page: "/sips"

Fields:

- Client

- Scheme

- SIP Amount

- Start Date

- Frequency (Monthly / Quarterly)

- Status (Active / Paused)

---

12. TRANSACTIONS

Simple list view:

- Client

- Scheme

- Amount

- Date

- Type

---

13. REPORTS

Basic report page:

- Select client

- Show all investments

- Show SIPs

- Export CSV (optional if easy)

No PDF required unless simple.

---

14. DATABASE DESIGN

Use Supabase tables:

clients

- id

- name

- mobile

- email

- address

- pan

- created_at

investments

- id

- client_id

- scheme

- type

- amount

- date

- payment_mode

- transaction_id

sips

- id

- client_id

- scheme

- amount

- frequency

- start_date

- status

---

15. VALIDATION

Basic validation only:

- Required fields

- Valid email

- Mobile number format

- PAN format (ABCDE1234F)

---

16. UI/UX DESIGN

Keep UI:

- Clean

- Minimal

- Easy to use

- Mobile responsive

- Dashboard style

Avoid:

- Over animations

- Complex charts

- Heavy UI frameworks

---

17. ERROR HANDLING

Show simple messages:

- "Something went wrong"

- "Please fill required fields"

No complex logging needed.

---

18. PERFORMANCE

Keep app lightweight:

- Simple queries

- Pagination optional

- No heavy analytics

---

19. SECURITY

Basic:

- Supabase Auth protection

- Protected routes

- No exposed keys

No advanced security layers needed.

---

20. SEED DATA

Add optional demo data:

- 3–5 clients

- 5–10 investments

- 2–3 SIPs

---

21. EMPTY STATES

Show:

"No data found"

Button:

"+ Add New"

---

22. FINAL REQUIREMENT

The app must:

- Work end-to-end

- Save real data in database

- Allow full CRUD for clients and in
also if possible publish it and give the URL (if not possible i will use vercel to deploy it)

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://fundbuddy-pro.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9f9bd005-04bd-47c2-8724-d04318059fcf).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
