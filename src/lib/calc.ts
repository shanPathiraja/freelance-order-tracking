/**
 * The financial calculation engine from section 4 of the scenario document.
 *
 * Everything here is a pure function over plain records. Nothing in this file
 * touches Firestore, React, or the clock — the only "now" comes in as an
 * argument, which is what makes the overdue logic testable.
 *
 *   Remaining Balance = Total Agreed Amount − Σ(Recorded Transactions)
 *   Freelancer Payout = Σ(Cleared Transactions) × (1 − Agency Commission Rate)
 *
 * Note the two different sums: the client's balance falls the moment a payment
 * is *recorded*, but the freelancer is only owed on what has *cleared*.
 */

import type {
  Invoice,
  InvoiceLineItem,
  PaymentStatus,
  Order,
  Transaction,
} from '../types/domain'
import { isAwaitingDelivery, isOpenOrder } from '../types/domain'
import { percentOfCents } from './money'

/** What one line is worth: quantity x unit price, rounded to whole cents. */
export function lineItemTotalCents(line: InvoiceLineItem): number {
  return Math.round(line.quantity * line.unitPriceCents)
}

/**
 * Σ of an invoice's line items. This is what gets written to
 * `amountDueCents` on save, so the rest of the engine never has to know
 * whether an invoice was itemised or entered as a single figure.
 */
export function lineItemsTotalCents(lines: InvoiceLineItem[]): number {
  return lines.reduce((sum, line) => sum + lineItemTotalCents(line), 0)
}

/** Σ of every transaction handed in, regardless of cleared status. */
export function recordedTotalCents(transactions: Transaction[]): number {
  return transactions.reduce((sum, t) => sum + t.amountCents, 0)
}

/** Σ of transactions that have actually landed. */
export function clearedTotalCents(transactions: Transaction[]): number {
  return transactions.reduce(
    (sum, t) => (t.status === 'cleared' ? sum + t.amountCents : sum),
    0,
  )
}

/**
 * Payment status derived from an amount owed and an amount paid.
 * Overpayment counts as fully paid — the balance simply goes negative, which
 * the UI surfaces as a credit rather than hiding it.
 */
export function derivePaymentStatus(
  dueCents: number,
  paidCents: number,
): PaymentStatus {
  if (paidCents <= 0) return 'unpaid'
  if (paidCents >= dueCents) return 'fully_paid'
  return 'partially_paid'
}

export interface InvoiceTotals {
  invoiceId: string
  amountDueCents: number
  paidCents: number
  /** Positive means the client still owes; negative means they overpaid. */
  balanceCents: number
  status: PaymentStatus
}

export function invoiceTotals(
  invoice: Invoice,
  transactions: Transaction[],
): InvoiceTotals {
  const forInvoice = transactions.filter((t) => t.invoiceId === invoice.id)
  const paidCents = recordedTotalCents(forInvoice)

  return {
    invoiceId: invoice.id,
    amountDueCents: invoice.amountDueCents,
    paidCents,
    balanceCents: invoice.amountDueCents - paidCents,
    status: derivePaymentStatus(invoice.amountDueCents, paidCents),
  }
}

export interface OrderTotals {
  orderId: string
  /**
   * What the client is on the hook for. For a fixed, milestone or on-delivery
   * order that is the agreed total. For a retainer there is no total —
   * `agreedAmountCents` is a monthly rate — so it is the sum of the months
   * actually invoiced.
   */
  committedCents: number
  agreedAmountCents: number
  /** Σ of invoices raised so far — can trail the agreed total mid-order. */
  invoicedCents: number
  /** Agreed total not yet written onto any invoice. Always 0 for a retainer. */
  uninvoicedCents: number
  paidCents: number
  clearedCents: number
  /** Committed − recorded payments, i.e. what the client still owes overall. */
  balanceCents: number
  /** What the freelancer keeps of the cleared money, after commission. */
  payoutCents: number
  status: PaymentStatus
}

export function orderTotals(
  order: Order,
  invoices: Invoice[],
  transactions: Transaction[],
): OrderTotals {
  const forOrder = invoices.filter((i) => i.orderId === order.id)
  const txns = transactions.filter((t) => t.orderId === order.id)

  const invoicedCents = forOrder.reduce((sum, i) => sum + i.amountDueCents, 0)
  const paidCents = recordedTotalCents(txns)
  const clearedCents = clearedTotalCents(txns)

  // A retainer is open-ended: it accrues a new obligation every month rather
  // than working down a fixed total, so what's owed is what's been billed.
  const isRetainer = order.billingType === 'monthly_retainer'
  const committedCents = isRetainer ? invoicedCents : order.agreedAmountCents

  return {
    orderId: order.id,
    committedCents,
    agreedAmountCents: order.agreedAmountCents,
    invoicedCents,
    uninvoicedCents: isRetainer
      ? 0
      : Math.max(order.agreedAmountCents - invoicedCents, 0),
    paidCents,
    clearedCents,
    balanceCents: committedCents - paidCents,
    payoutCents: freelancerPayoutCents(clearedCents, order.commissionRate),
    status: derivePaymentStatus(committedCents, paidCents),
  }
}

/** Freelancer Payout = Σ(Cleared Transactions) × (1 − Agency Commission Rate). */
export function freelancerPayoutCents(
  clearedCents: number,
  commissionRate: number,
): number {
  const rate = Math.min(Math.max(commissionRate, 0), 1)
  return clearedCents - percentOfCents(clearedCents, rate)
}

/**
 * A retainer only rolls forward while the previous month is settled — rule 2
 * of Scenario B.
 *
 * The month being worked is whichever is later: the calendar month we are in,
 * or the furthest month already invoiced. Comparing against the calendar month
 * alone would miss the case where the freelancer has raised next month's
 * invoice early while this month is still unpaid — the exact situation the
 * rule exists to catch.
 */
export function isRetainerClearToContinue(
  currentPeriodKey: string,
  invoices: Invoice[],
  transactions: Transaction[],
): boolean {
  const workingPeriod = invoices.reduce(
    (latest, invoice) =>
      invoice.periodKey && invoice.periodKey > latest ? invoice.periodKey : latest,
    currentPeriodKey,
  )

  return invoices
    .filter((i) => i.periodKey !== undefined && i.periodKey < workingPeriod)
    .every((i) => invoiceTotals(i, transactions).status === 'fully_paid')
}

export type DueBucket = 'overdue' | 'due_soon' | 'upcoming' | 'settled'

/**
 * Which attention bucket an invoice falls into. Phase 1 has no cron sending
 * reminders, so the dashboard reads these buckets instead — same intent as the
 * document's "3 days before and on the due date" trigger, freelancer-driven.
 */
export function dueBucket(
  invoice: Invoice,
  transactions: Transaction[],
  today: string,
  soonWindowDays = 3,
): DueBucket {
  if (invoiceTotals(invoice, transactions).status === 'fully_paid') {
    return 'settled'
  }
  if (invoice.dueDate < today) return 'overdue'

  return daysBetween(today, invoice.dueDate) <= soonWindowDays
    ? 'due_soon'
    : 'upcoming'
}

/**
 * How urgently an order needs *delivering*. Separate from `dueBucket`, which
 * is about money: an order can be fully paid and still overdue for delivery.
 *
 * 'none' covers both "no promised date" and "no longer active" — in either
 * case there is nothing to chase.
 */
export type DeliveryBucket = 'overdue' | 'due_soon' | 'upcoming' | 'none'

export function deliveryBucket(
  order: Order,
  now: Date,
  // A week, not the three days used for payment reminders: design work needs
  // more notice than a bank transfer does.
  soonWindowDays = 7,
): DeliveryBucket {
  const dueAt = orderDueAt(order)
  if (!dueAt || !isAwaitingDelivery(order.status)) return 'none'

  const remaining = dueAt.getTime() - now.getTime()
  if (remaining < 0) return 'overdue'

  return remaining <= soonWindowDays * MS_PER_DAY ? 'due_soon' : 'upcoming'
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The exact instant an order is due, in local time, or null if it has no date.
 *
 * With no `dueTime` the deadline is the last moment of `dueDate` — an order
 * "due on the 20th" is not late at 9am on the 20th. Getting this wrong would
 * mark every dateless-time order overdue from midnight.
 */
export function orderDueAt(order: Pick<Order, 'dueDate' | 'dueTime'>): Date | null {
  if (!order.dueDate) return null

  const [year, month, day] = order.dueDate.split('-').map(Number)
  if (!year || !month || !day) return null

  if (!order.dueTime) return new Date(year, month - 1, day, 23, 59, 59, 999)

  const [hours, minutes] = order.dueTime.split(':').map(Number)
  return new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0)
}

/** Milliseconds until an order is due. Negative once it is late. */
export function remainingMs(
  order: Pick<Order, 'dueDate' | 'dueTime'>,
  now: Date,
): number | null {
  const dueAt = orderDueAt(order)
  return dueAt ? dueAt.getTime() - now.getTime() : null
}

/**
 * A countdown a human can read at a glance: '3d 5h', '5h 12m', '42m 18s'.
 *
 * Only ever two units — the second one stops mattering once the first is
 * large, and a four-part duration is harder to read, not more precise.
 * Seconds appear only under an hour, which is the point at which they start
 * being useful rather than noise.
 */
export function formatDuration(ms: number): string {
  const total = Math.abs(ms)
  const days = Math.floor(total / MS_PER_DAY)
  const hours = Math.floor((total % MS_PER_DAY) / (60 * 60 * 1000))
  const minutes = Math.floor((total % (60 * 60 * 1000)) / (60 * 1000))
  const seconds = Math.floor((total % (60 * 1000)) / 1000)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** The countdown as shown to the user, including whether it has run out. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return `${formatDuration(ms)} late`
  return formatDuration(ms)
}

/** Whole days from one ISO date to another. Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((Date.parse(to) - Date.parse(from)) / msPerDay)
}

/** Today as an ISO 'YYYY-MM-DD' string in the user's own timezone. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** The 'YYYY-MM' period key a date falls in. */
export function periodKeyOf(date: string): string {
  return date.slice(0, 7)
}

export interface DashboardSummary {
  /** Σ committed amounts across active orders — the book of work. */
  totalAgreedCents: number
  /** Σ every recorded payment. */
  collectedCents: number
  /** Σ payments still marked pending, i.e. logged but not in the bank. */
  pendingClearanceCents: number
  /** Σ outstanding balances across active orders. */
  outstandingCents: number
  /** What the freelancer has actually earned, net of commission. */
  payoutCents: number
  overdueInvoices: number
  dueSoonInvoices: number
  /** Active orders whose delivery date has passed. */
  overdueDeliveries: number
  /** Active orders due for delivery within the week. */
  deliveriesDueSoon: number
  activeOrders: number
}

export function dashboardSummary(
  orders: Order[],
  invoices: Invoice[],
  transactions: Transaction[],
  /**
   * The current instant. Delivery deadlines can carry a time of day, so this
   * has to be a moment rather than a date; the invoice side derives its date
   * from it.
   */
  now: Date,
): DashboardSummary {
  const today = todayIso(now)
  const active = orders.filter((o) => isOpenOrder(o.status))
  const totals = active.map((p) => orderTotals(p, invoices, transactions))

  const activeOrderIds = new Set(active.map((p) => p.id))
  const activeInvoices = invoices.filter((i) => activeOrderIds.has(i.orderId))

  const buckets = activeInvoices.map((i) => dueBucket(i, transactions, today))
  const deliveries = active.map((o) => deliveryBucket(o, now))

  return {
    totalAgreedCents: sumBy(totals, (t) => t.committedCents),
    collectedCents: sumBy(totals, (t) => t.paidCents),
    pendingClearanceCents: sumBy(totals, (t) => t.paidCents - t.clearedCents),
    // A negative balance is a credit on one order; it must not quietly cancel
    // out real debt on another, so overpayments are floored at zero here.
    outstandingCents: sumBy(totals, (t) => Math.max(t.balanceCents, 0)),
    payoutCents: sumBy(totals, (t) => t.payoutCents),
    overdueInvoices: buckets.filter((b) => b === 'overdue').length,
    dueSoonInvoices: buckets.filter((b) => b === 'due_soon').length,
    overdueDeliveries: deliveries.filter((b) => b === 'overdue').length,
    deliveriesDueSoon: deliveries.filter((b) => b === 'due_soon').length,
    activeOrders: active.length,
  }
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + pick(item), 0)
}
