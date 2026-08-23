/**
 * Domain model for the freelancer tracking ledger.
 *
 * Money is stored everywhere as integer cents. Never use floats for amounts —
 * 0.1 + 0.2 !== 0.3 and a ledger that drifts by a cent is worse than no ledger.
 * Dates that a human picks (due dates, payment dates) are ISO 'YYYY-MM-DD'
 * strings so they carry no timezone; machine timestamps are epoch millis.
 */

/** How a project's total is broken into invoices. */
export type BillingType =
  /** Fixed price split across two invoices, e.g. 50% advance + 50% on delivery. */
  | 'fixed_split'
  /** One invoice per delivered milestone, amounts set as the project progresses. */
  | 'milestone'
  /** One invoice per calendar month for ongoing work. */
  | 'monthly_retainer'
  /** Single invoice, collected once the work is handed over. */
  | 'on_delivery'

/** Derived from summed transactions — never set by hand. */
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'fully_paid'

/**
 * Logged vs. actually in the bank. A transaction counts toward the client's
 * balance as soon as it is recorded, but only counts toward the freelancer's
 * payout once cleared. Phase 1 flips this by hand; a payment gateway will
 * drive it later.
 */
export type TransactionStatus = 'pending' | 'cleared'

export type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'other'

export type ProjectStatus = 'active' | 'completed' | 'cancelled'

/** Fields every record carries. `ownerId` is what the Firestore rules match on. */
interface OwnedRecord {
  id: string
  ownerId: string
  createdAt: number
}

export interface Client extends OwnedRecord {
  name: string
  /** Digits only, country code first, no '+' — ready to drop into a wa.me link. */
  whatsapp: string
  email?: string
  notes?: string
}

export interface Project extends OwnedRecord {
  clientId: string
  title: string
  billingType: BillingType
  /** What the client agreed to pay in total, in cents. */
  agreedAmountCents: number
  /** Agency cut taken off the freelancer's payout, 0–1. 0 means solo. */
  commissionRate: number
  status: ProjectStatus
  notes?: string
}

/**
 * A billable line on an invoice: '4 | FB Post | 1000.00 | 4,000.00'.
 *
 * `quantity` is a plain number, not cents — it counts things. A zero
 * `unitPriceCents` is legitimate and means the line was included at no charge,
 * which the sample invoice uses for bundled work.
 */
export interface InvoiceLineItem {
  description: string
  quantity: number
  unitPriceCents: number
}

export interface Invoice extends OwnedRecord {
  projectId: string
  /** Denormalised so the dashboard can query invoices without loading projects. */
  clientId: string
  /** Human label: '50% Advance', 'Milestone 2 — Brand guidelines', 'March 2026'. */
  label: string
  amountDueCents: number
  /** ISO 'YYYY-MM-DD'. */
  dueDate: string
  /** For retainers only: 'YYYY-MM', used to stop double-billing a month. */
  periodKey?: string
  /**
   * Itemised breakdown, when the invoice has one. `amountDueCents` stays the
   * single source of truth for every balance calculation — it is derived from
   * these lines on save, so nothing downstream has to know about them, and
   * invoices raised automatically (a 50/50 split, a retainer month) simply
   * have none.
   */
  lineItems?: InvoiceLineItem[]
}

/**
 * The freelancer's own details, printed at the top and bottom of an invoice.
 * One document per owner.
 */
export interface BusinessProfile {
  businessName: string
  tagline?: string
  email?: string
  mobile?: string
  website?: string
  facebook?: string
  /** Closing line above the footer, e.g. 'Thank you for joining with us'. */
  thankYouNote?: string
  /** The blurb in the footer band. */
  footerNote?: string
}

export const EMPTY_BUSINESS_PROFILE: BusinessProfile = {
  businessName: '',
}

export interface Transaction extends OwnedRecord {
  invoiceId: string
  /** Denormalised for the same reason as Invoice.clientId. */
  projectId: string
  clientId: string
  amountCents: number
  /** ISO 'YYYY-MM-DD' — the day the client actually paid. */
  paidOn: string
  method: PaymentMethod
  status: TransactionStatus
  /** Bank reference, cheque number, or a note about the WhatsApp screenshot. */
  reference?: string
}

export const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  fixed_split: 'Fixed (split)',
  milestone: 'Milestone',
  monthly_retainer: 'Monthly retainer',
  on_delivery: 'Pay on delivery',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially Paid',
  fully_paid: 'Fully Paid',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
}
