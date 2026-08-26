/**
 * Turning an order's billing type into actual invoices.
 *
 * Each of the four billing types in the scenario document is just a different
 * schedule of invoices against the same agreed total, which is what lets one
 * Invoice shape serve all of them.
 */

import { splitCents } from './money'
import { periodKeyOf, todayIso } from './calc'
import type { BillingType, Invoice, Order } from '../types/domain'

export type InvoiceDraft = Omit<Invoice, 'id' | 'ownerId' | 'createdAt'>

/** Add days to an ISO date, staying in local time. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  return todayIso(date)
}

/** First day of the month `offset` months from the given ISO date. */
export function startOfMonth(isoDate: string, offset = 0): string {
  const [year, month] = isoDate.split('-').map(Number)
  return todayIso(new Date(year, month - 1 + offset, 1))
}

export function monthLabel(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

/**
 * The invoices to raise when an order is first created.
 *
 * Milestone orders get nothing — their amounts aren't known until each phase
 * is agreed, so the freelancer adds them as the work progresses.
 */
export function initialInvoices(
  order: Pick<Order, 'id' | 'clientId' | 'billingType' | 'agreedAmountCents'>,
  today: string,
  paymentTermsDays = 7,
): InvoiceDraft[] {
  const base = { orderId: order.id, clientId: order.clientId }

  switch (order.billingType) {
    case 'fixed_split': {
      const [advance, balance] = splitCents(order.agreedAmountCents, 2)
      return [
        {
          ...base,
          label: '50% Advance',
          amountDueCents: advance,
          dueDate: today,
        },
        {
          ...base,
          label: 'Balance on delivery',
          amountDueCents: balance,
          dueDate: addDays(today, paymentTermsDays),
        },
      ]
    }

    case 'monthly_retainer': {
      const periodKey = periodKeyOf(today)
      return [
        {
          ...base,
          label: monthLabel(periodKey),
          amountDueCents: order.agreedAmountCents,
          dueDate: startOfMonth(today),
          periodKey,
        },
      ]
    }

    case 'on_delivery':
      return [
        {
          ...base,
          label: 'Payment on delivery',
          amountDueCents: order.agreedAmountCents,
          dueDate: addDays(today, paymentTermsDays),
        },
      ]

    case 'milestone':
      return []
  }
}

/**
 * The next month's retainer invoice, or null if that month is already raised.
 * The caller checks `isRetainerClearToContinue` separately — an unpaid previous
 * month should warn the freelancer, not silently block them.
 */
export function nextRetainerInvoice(
  order: Pick<Order, 'id' | 'clientId' | 'agreedAmountCents'>,
  existing: Invoice[],
  today: string,
): InvoiceDraft | null {
  const raised = new Set(
    existing
      .filter((i) => i.orderId === order.id && i.periodKey)
      .map((i) => i.periodKey as string),
  )

  // Walk forward from this month to the first month not yet billed, so a
  // freelancer who forgot to invoice in March still bills March before April.
  for (let offset = 0; offset <= 12; offset += 1) {
    const monthStart = startOfMonth(today, offset)
    const periodKey = periodKeyOf(monthStart)

    if (!raised.has(periodKey)) {
      return {
        orderId: order.id,
        clientId: order.clientId,
        label: monthLabel(periodKey),
        amountDueCents: order.agreedAmountCents,
        dueDate: monthStart,
        periodKey,
      }
    }
  }

  return null
}

export const BILLING_TYPE_HINTS: Record<BillingType, string> = {
  fixed_split:
    'Raises two invoices now: half up front, half on delivery.',
  milestone:
    'No invoices yet — add one per phase as you agree each milestone.',
  monthly_retainer:
    'Raises this month now. Generate each following month from the order page.',
  on_delivery: 'Raises a single invoice, collected once you hand the work over.',
}
