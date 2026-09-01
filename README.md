# Freelance Ledger

A payment tracker for a freelance designer working over WhatsApp. Built from
[the scenario document](doc/Freelancer_Tracking_System_Scenario.pdf).

**Phase 1 is a manual ledger.** No payment gateway, no WhatsApp Business API —
the freelancer enters every payment by hand. The automation described in the
scenario document is deferred to phase 2; see [Phase 2](#phase-2) for what
changes and what it costs.

## The core idea

`Order` (what was agreed) is kept separate from `Transaction` (what was
actually paid). Every status is *derived* from summed transactions, never
stored by hand, so a balance can't drift out of sync with its payments.

Sitting between them, an `Invoice` is what makes all four billing types share
one shape:

| Billing type | Invoices raised |
| --- | --- |
| Fixed split (50/50) | Two — advance now, balance on delivery |
| Milestone | One per phase, added as each is agreed |
| Monthly retainer | One per calendar month |
| Pay on delivery | One, collected at handover |

A `Transaction` always attaches to an `Invoice`. Nothing about phase 2 forces a
change to this schema.

An invoice can also carry **line items** — `4 | FB Post | 1000.00 | 4,000.00`.
When it does, `amountDueCents` is derived from them on save, so every balance
calculation downstream is unchanged and invoices raised automatically (a 50/50
split, a retainer month) simply have no lines.

## Money rules

Two sums, deliberately different:

```
Remaining Balance = Total Agreed Amount − Σ(Recorded Transactions)
Freelancer Payout = Σ(Cleared Transactions) × (1 − Agency Commission Rate)
```

A payment counts against the client's balance the moment it's **recorded**, but
only counts toward the freelancer's payout once it's **cleared** — i.e. the
money actually landed. In phase 1 you flip that with the "Mark cleared" button;
in phase 2 a gateway webhook will do it.

All amounts are stored as **integer cents** — hundredths of a rupee. Never
introduce a float into the money path.

Currency is **LKR**, rendered `Rs 12,278.00`. That symbol is deliberately not
`Intl` currency formatting, which renders LKR as the ISO code
("LKR 12,278.00"); see `CURRENCY_SYMBOL` in `src/lib/money.ts`.

## Order lifecycle

An order moves through six stages, advanced by hand — nothing changes it
automatically, because only you know when a client has actually confirmed or
when work has gone out:

`initial` → `confirmed` → `started` → `delivered` → `payment_pending` → `completed`

`cancelled` sits outside that run as an escape hatch. Without it the only way
to clear a dead order off the dashboard would be to pretend it completed.

Two things follow from the stage:

- **Open vs closed.** Everything up to and including `payment_pending` counts
  toward outstanding money and the active ledger. `completed` and `cancelled`
  are history.
- **Delivery chasing stops at `delivered`.** A due date is only worth chasing
  while the work is still outstanding.

The stage is manual while payment status is *derived* from transactions, so the
two can disagree. The order page says so rather than letting it rot — a
`completed` order with money still owed, or a `payment_pending` order that is
fully paid, both get a banner.

Orders written before this existed carry the old `active` value;
`normaliseOrderStatus` maps it to `confirmed` on read, so no database migration
was needed.

## Delivery dates vs payment dates

An `Order` carries an optional `dueDate` — when the **work** is promised. Each
`Invoice` carries its own `dueDate` — when the **money** is expected. They are
deliberately independent: an order can be paid up front and still be overdue to
deliver, or delivered on time and never paid.

The dashboard reflects that with two separate lists: **Deliveries due** (orders,
a week's warning) and **Needs chasing** (invoices, three days' warning, matching
the scenario document's reminder window).

An order's deadline can carry a **time of day** (`dueTime`, `HH:mm` local). With
no time, the deadline is the *end* of `dueDate` — "due on the 20th" is not late
at 9am on the 20th, and treating a bare date as midnight would mark every such
order overdue the moment the day began.

Both lists show a **live countdown** — `3d 5h`, `5h 12m`, `42m 18s`, or
`1h 35m late`. Seconds appear only under an hour, where they start being useful
rather than noise. One `useNow()` timer drives every countdown on a page, so a
list of ten orders costs one interval and one re-render per tick.

The clock enters the app only through `useNow()`; everything in `calc.ts` takes
`now` as an argument, which is what keeps the deadline logic testable.

One client can have any number of orders; each is billed and tracked on its own.

## Setup

Firebase project: **`freelancer-tracking-system`** (already wired up —
`.firebaserc` pins it, so no `--project` flag is needed on any command).

The free Spark plan is enough. **Do not add Cloud Functions or App Hosting** —
those require the Blaze plan and a card on file. This app is a client-rendered
SPA precisely so it stays on Spark.

### 1. Local config

`.env.local` already holds the real project's web config. It is gitignored, so
a fresh clone needs it recreated:

```bash
npx firebase-tools apps:sdkconfig WEB
```

Copy the values into `.env.local` using `.env.example` as the template. These
are **not secrets** — a web app's Firebase config is public by design. The
security rules are what protect the data.

### 2. Enable Email/Password sign-in

Console only; the CLI cannot do this. In
**Build → Authentication → Sign-in method**, enable **Email/Password**, then add
your account under the **Users** tab. There is no public sign-up — accounts are
created here by hand.

### 3. Deploy the security rules

```bash
npx firebase-tools deploy --only firestore:rules
```

Do this before putting real data in. A database created in test mode is
**world-readable** until these rules land — anyone with the project id can read
every client name and figure in it.

### 4. Run

```bash
npm install && npm run dev
```

Opens on <http://localhost:3600>.

## Developing against the emulator

Work against throwaway data instead of your real project — no quota spend, and
you can exercise the security rules safely.

```bash
npm run emulators
```

Then set `VITE_USE_EMULATORS=true` in `.env.local` along with any `demo-`
prefixed project id (`demo-` ids are reserved by Firebase for emulator use and
can never reach a real project). Run `npm run dev` in a second terminal.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3600 |
| `npm test` | Run the calculation engine tests |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run emulators` | Firebase Auth + Firestore emulators |
| `npm run lint` | oxlint |

## Deploying

Pushing to `main` deploys automatically — see [doc/ci-cd.md](doc/ci-cd.md).
Tests gate the release, and the pipeline refuses to ship a bundle that is
missing its Firebase config.

To deploy by hand:

```bash
npm run build
npx firebase-tools deploy --only hosting
```

Firebase Hosting serves static files on the free plan. `firebase.json` already
rewrites all routes to `index.html` for client-side routing.

## Printing an invoice

Every invoice has an **Invoice** button on the order page that opens a
print-ready sheet at `/invoices/:id/print`, laid out to match the reference
design in `doc/`. The browser's own print dialog saves it as a PDF — there is
no PDF library in the bundle.

The header, contact block and footer come from **Settings → Business details**,
stored as one document per owner in `settings/{uid}`. Totals are not stored on
the sheet: Total is the invoice amount, Paid is the sum of its transactions,
and Balance is the difference, all computed at render time.

`@media print` in `index.css` hides the app chrome and sets A4. It also forces
`print-color-adjust: exact`, without which Chrome drops the banner and the
Total/Paid/Balance row colours.

## Sending a payment request

A client with several orders should get one ask, not one per invoice. The
**Statement** button on a client card opens `/clients/:id/statement`: every
outstanding invoice across every order, every payment received, and a single
balance due. **Request payment** opens WhatsApp with the same summary.

What a statement includes:

- Orders that are open show all their invoices, paid ones included, so the
  client can see credit for what they have already settled.
- Closed orders appear only if they still owe something.
- Cancelled orders never appear — billing for work you cancelled is the worst
  error this could make.

## Tests

The money logic is pure functions in [`src/lib/calc.ts`](src/lib/calc.ts) with
no Firestore, React, or clock dependency — the "current date" is always an
argument, which is what makes the overdue logic testable.

The test suite encodes the scenario document's three worked examples directly:
Burger Craft's 50/50 split, Aura Fashion's retainer gating, and Nova Code's
$1,000 → $700 → $300 → $0 milestone walk. If a change breaks the document's
arithmetic, those tests fail by name.

```bash
npm test
```

## Architecture notes

- **Whole-workspace loading.** `loadWorkspace()` reads all four collections in
  four queries and totals are computed in memory. One freelancer's book of work
  is a few hundred records; running aggregates would be more code and more ways
  to be wrong, and this stays well inside Spark's daily read allowance.
- **`ownerId` on every record.** Enforced by `firestore.rules` on both read and
  write, so a user can't create records owned by anyone else. Single-user today,
  but multi-user needs no migration.
- **WhatsApp via `wa.me` links.** No API, no Business account, no cost. The
  button opens *your* WhatsApp with the message pre-filled and you press send.
  Message wording lives in [`src/lib/whatsapp.ts`](src/lib/whatsapp.ts) so
  phase 2 can swap the transport without rewriting the copy.
- **Phone numbers are expanded to international format.** `wa.me` refuses
  anything with a leading zero or a missing country code — it fails with a bare
  "This link couldn't be opened", naming nothing. `normalisePhone` swaps a
  national trunk zero for `DEFAULT_COUNTRY_CODE` (`94`, Sri Lanka — one line to
  change in `src/lib/whatsapp.ts`), and the client form shows the resolved
  number so the expansion is never a silent guess.
- **Reminders are a dashboard, not a cron.** The scenario document's "3 days
  before and on the due date" trigger becomes the "Needs chasing" list, sorted
  worst-first. Same intent, freelancer-driven.

## Phase 2

What the scenario document describes but this phase doesn't do, and what each
will cost:

| Feature | Requires |
| --- | --- |
| Auto-send invoices and receipts | WhatsApp Business API — a paid provider, per-conversation pricing |
| Scheduled overdue reminders | Cloud Scheduler + Functions → **Blaze plan** (card required, small usage is free) |
| Auto-generate retainer invoices on the 1st | Same as above; today it's a button on the order page |
| Gateway payment links | A payment provider; would drive `Transaction.status` to `cleared` automatically |

The `pending` / `cleared` distinction on transactions already exists precisely
so a gateway has somewhere to write.

## Note on `npm install`

npm 10.x has an [arborist bug](https://github.com/npm/cli/issues) that crashes
resolving vitest 4's optional peer dependencies when building a lockfile from
scratch. The committed `package-lock.json` avoids it. If you ever need to
regenerate the lockfile, use `npm install --legacy-peer-deps`.
