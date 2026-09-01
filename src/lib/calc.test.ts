import { describe, expect, it } from 'vitest'

import {
  clearedTotalCents,
  clientStatement,
  dashboardSummary,
  daysBetween,
  deliveryBucket,
  derivePaymentStatus,
  dueBucket,
  formatDuration,
  formatRemaining,
  freelancerPayoutCents,
  invoiceTotals,
  isRetainerClearToContinue,
  lineItemsTotalCents,
  lineItemTotalCents,
  orderDueAt,
  orderTotals,
  recordedTotalCents,
  remainingMs,
  todayIso,
} from './calc'
import { parseAmountToCents, percentOfCents, splitCents } from './money'
import {
  normaliseOrderStatus,
  OPEN_ORDER_STATUSES,
  type Invoice,
  type Order,
  type OrderStatus,
  type Transaction,
} from '../types/domain'

const OWNER = 'owner-1'

/** An instant at midday on the given ISO date, in local time. */
function at(isoDate: string, hours = 12, minutes = 0): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d, hours, minutes)
}

function order(over: Partial<Order> & { id: string }): Order {
  return {
    ownerId: OWNER,
    createdAt: 0,
    clientId: 'client-1',
    title: 'Untitled',
    billingType: 'fixed_split',
    agreedAmountCents: 0,
    commissionRate: 0,
    status: 'confirmed',
    ...over,
  }
}

function invoice(over: Partial<Invoice> & { id: string }): Invoice {
  return {
    ownerId: OWNER,
    createdAt: 0,
    orderId: 'order-1',
    clientId: 'client-1',
    label: 'Invoice',
    amountDueCents: 0,
    dueDate: '2026-03-01',
    ...over,
  }
}

function txn(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    ownerId: OWNER,
    createdAt: 0,
    invoiceId: 'invoice-1',
    orderId: 'order-1',
    clientId: 'client-1',
    amountCents: 0,
    paidOn: '2026-03-01',
    method: 'bank_transfer',
    status: 'cleared',
    ...over,
  }
}

describe('money parsing', () => {
  it('accepts the shapes a human actually types', () => {
    expect(parseAmountToCents('400')).toBe(40_000)
    expect(parseAmountToCents('400.00')).toBe(40_000)
    expect(parseAmountToCents('$1,000.50')).toBe(100_050)
    expect(parseAmountToCents(' 300 ')).toBe(30_000)
  })

  it('rejects anything that is not a non-negative amount', () => {
    expect(parseAmountToCents('')).toBeNull()
    expect(parseAmountToCents('abc')).toBeNull()
    expect(parseAmountToCents('-50')).toBeNull()
    expect(parseAmountToCents('1.2.3')).toBeNull()
  })

  it('rounds sub-cent input instead of truncating it', () => {
    expect(parseAmountToCents('0.015')).toBe(2)
  })
})

describe('splitCents', () => {
  it('splits evenly when it can', () => {
    expect(splitCents(40_000, 2)).toEqual([20_000, 20_000])
  })

  it('never loses a cent to rounding', () => {
    const parts = splitCents(10_000, 3)
    expect(parts).toEqual([3_334, 3_333, 3_333])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000)
  })
})

describe('Scenario A — Burger Craft, 50/50 split on $400', () => {
  const burgerCraft = order({
    id: 'p-burger',
    title: 'Menu Design & Banner Printing',
    billingType: 'fixed_split',
    agreedAmountCents: 40_000,
  })

  const advance = invoice({
    id: 'i-advance',
    orderId: 'p-burger',
    label: '50% Advance',
    amountDueCents: 20_000,
  })

  const balance = invoice({
    id: 'i-balance',
    orderId: 'p-burger',
    label: 'Balance on delivery',
    amountDueCents: 20_000,
  })

  it('reads Partially Paid with $200 outstanding after the advance', () => {
    const paid = [
      txn({ id: 't1', invoiceId: 'i-advance', orderId: 'p-burger', amountCents: 20_000 }),
    ]

    const totals = orderTotals(burgerCraft, [advance, balance], paid)

    expect(totals.paidCents).toBe(20_000)
    expect(totals.balanceCents).toBe(20_000)
    expect(totals.status).toBe('partially_paid')
    expect(invoiceTotals(advance, paid).status).toBe('fully_paid')
    expect(invoiceTotals(balance, paid).status).toBe('unpaid')
  })

  it('reads Fully Paid once the delivery balance lands', () => {
    const paid = [
      txn({ id: 't1', invoiceId: 'i-advance', orderId: 'p-burger', amountCents: 20_000 }),
      txn({ id: 't2', invoiceId: 'i-balance', orderId: 'p-burger', amountCents: 20_000 }),
    ]

    const totals = orderTotals(burgerCraft, [advance, balance], paid)

    expect(totals.balanceCents).toBe(0)
    expect(totals.status).toBe('fully_paid')
  })
})

describe('Scenario B — Aura Fashion, $300/month retainer', () => {
  const march = invoice({
    id: 'i-march',
    label: 'March 2026',
    amountDueCents: 30_000,
    dueDate: '2026-03-01',
    periodKey: '2026-03',
  })

  const april = invoice({
    id: 'i-april',
    label: 'April 2026',
    amountDueCents: 30_000,
    dueDate: '2026-04-01',
    periodKey: '2026-04',
  })

  it('blocks the next month while the previous one is unpaid', () => {
    expect(isRetainerClearToContinue('2026-04', [march, april], [])).toBe(false)
  })

  it('rolls forward once the previous month settles', () => {
    const paid = [txn({ id: 't1', invoiceId: 'i-march', amountCents: 30_000 })]
    expect(isRetainerClearToContinue('2026-04', [march, april], paid)).toBe(true)
  })

  it('does not warn while the only month raised is the one being worked', () => {
    expect(isRetainerClearToContinue('2026-03', [march], [])).toBe(true)
  })

  it('warns when next month is raised early and this month is still unpaid', () => {
    // Still March on the calendar, but April has already been invoiced — the
    // freelancer is about to work a month ahead of an unpaid one.
    expect(isRetainerClearToContinue('2026-03', [march, april], [])).toBe(false)
  })

  it('flags the invoice as overdue past the 5th', () => {
    expect(dueBucket(march, [], '2026-03-06')).toBe('overdue')
  })

  it('warns three days out, matching the document reminder window', () => {
    expect(dueBucket(april, [], '2026-03-29')).toBe('due_soon')
    expect(dueBucket(april, [], '2026-03-20')).toBe('upcoming')
  })

  it('stops nagging once the month is paid', () => {
    const paid = [txn({ id: 't1', invoiceId: 'i-march', amountCents: 30_000 })]
    expect(dueBucket(march, paid, '2026-03-06')).toBe('settled')
  })
})

describe('Scenario C — Nova Code, $1,000 brand identity in three milestones', () => {
  const novaCode = order({
    id: 'p-nova',
    title: 'Full Brand Identity Package',
    billingType: 'milestone',
    agreedAmountCents: 100_000,
  })

  const invoices = [
    invoice({ id: 'm1', orderId: 'p-nova', label: 'Logos', amountDueCents: 30_000 }),
    invoice({ id: 'm2', orderId: 'p-nova', label: 'Guidelines', amountDueCents: 40_000 }),
    invoice({ id: 'm3', orderId: 'p-nova', label: 'Asset handoff', amountDueCents: 30_000 }),
  ]

  it('walks the balance down 700 -> 300 -> 0 as the document describes', () => {
    const payments = [
      txn({ id: 't1', invoiceId: 'm1', orderId: 'p-nova', amountCents: 30_000 }),
      txn({ id: 't2', invoiceId: 'm2', orderId: 'p-nova', amountCents: 40_000 }),
      txn({ id: 't3', invoiceId: 'm3', orderId: 'p-nova', amountCents: 30_000 }),
    ]

    const balancesAfterEachPayment = payments.map((_, i) =>
      orderTotals(novaCode, invoices, payments.slice(0, i + 1)).balanceCents,
    )

    expect(balancesAfterEachPayment).toEqual([70_000, 30_000, 0])
  })

  it('tracks how much of the agreed total is not yet invoiced', () => {
    const totals = orderTotals(novaCode, invoices.slice(0, 1), [])

    expect(totals.invoicedCents).toBe(30_000)
    expect(totals.uninvoicedCents).toBe(70_000)
  })
})

describe('a retainer accrues rather than working down a total', () => {
  const retainer = order({
    id: 'p-aura',
    billingType: 'monthly_retainer',
    // The agreed amount is a monthly rate, not an order total.
    agreedAmountCents: 30_000,
  })

  const august = invoice({
    id: 'i-aug',
    orderId: 'p-aura',
    amountDueCents: 30_000,
    periodKey: '2026-08',
  })

  const september = invoice({
    id: 'i-sep',
    orderId: 'p-aura',
    amountDueCents: 30_000,
    periodKey: '2026-09',
  })

  it('owes the sum of months billed, not the monthly rate', () => {
    const paidAugustOnly = [
      txn({ id: 't1', invoiceId: 'i-aug', orderId: 'p-aura', amountCents: 30_000 }),
    ]

    const totals = orderTotals(retainer, [august, september], paidAugustOnly)

    expect(totals.committedCents).toBe(60_000)
    // The bug this guards: agreed(300) − paid(300) would read as settled while
    // September is still outstanding.
    expect(totals.balanceCents).toBe(30_000)
    expect(totals.status).toBe('partially_paid')
  })

  it('settles only when every billed month is paid', () => {
    const paidBoth = [
      txn({ id: 't1', invoiceId: 'i-aug', orderId: 'p-aura', amountCents: 30_000 }),
      txn({ id: 't2', invoiceId: 'i-sep', orderId: 'p-aura', amountCents: 30_000 }),
    ]

    expect(orderTotals(retainer, [august, september], paidBoth).status).toBe(
      'fully_paid',
    )
  })

  it('has nothing "uninvoiced" — there is no total to invoice against', () => {
    expect(orderTotals(retainer, [august], []).uninvoicedCents).toBe(0)
  })
})

describe('recorded vs cleared', () => {
  const transactions = [
    txn({ id: 't1', amountCents: 30_000, status: 'cleared' }),
    txn({ id: 't2', amountCents: 20_000, status: 'pending' }),
  ]

  it('counts pending money toward the balance but not the payout', () => {
    expect(recordedTotalCents(transactions)).toBe(50_000)
    expect(clearedTotalCents(transactions)).toBe(30_000)
  })

  it('drops the client balance as soon as a payment is recorded', () => {
    const p = order({ id: 'order-1', agreedAmountCents: 50_000 })
    const totals = orderTotals(p, [], transactions)

    expect(totals.balanceCents).toBe(0)
    expect(totals.status).toBe('fully_paid')
    // ...but only the cleared 300 is actually earned.
    expect(totals.payoutCents).toBe(30_000)
  })
})

describe('freelancer payout', () => {
  it('returns everything when there is no agency cut', () => {
    expect(freelancerPayoutCents(100_000, 0)).toBe(100_000)
  })

  it('applies the commission rate', () => {
    expect(freelancerPayoutCents(100_000, 0.2)).toBe(80_000)
  })

  it('rounds to whole cents rather than leaving fractions', () => {
    // 333.33 * 15% = 49.9995 -> 50.00 commission, 283.33 payout.
    expect(percentOfCents(33_333, 0.15)).toBe(5_000)
    expect(freelancerPayoutCents(33_333, 0.15)).toBe(28_333)
  })

  it('clamps a nonsense rate instead of inventing money', () => {
    expect(freelancerPayoutCents(10_000, 1.5)).toBe(0)
    expect(freelancerPayoutCents(10_000, -0.5)).toBe(10_000)
  })
})

describe('derivePaymentStatus', () => {
  it('treats an overpayment as fully paid', () => {
    expect(derivePaymentStatus(20_000, 25_000)).toBe('fully_paid')
  })

  it('treats a zero-value invoice with no payment as unpaid', () => {
    expect(derivePaymentStatus(0, 0)).toBe('unpaid')
  })
})

describe('dashboard summary', () => {
  const orders = [
    order({ id: 'p1', agreedAmountCents: 40_000, commissionRate: 0.1 }),
    order({ id: 'p2', agreedAmountCents: 15_000 }),
    order({ id: 'p3', agreedAmountCents: 99_900, status: 'completed' }),
  ]

  const invoices = [
    invoice({ id: 'i1', orderId: 'p1', amountDueCents: 20_000, dueDate: '2026-03-01' }),
    invoice({ id: 'i2', orderId: 'p2', amountDueCents: 15_000, dueDate: '2026-03-10' }),
    invoice({ id: 'i3', orderId: 'p3', amountDueCents: 99_900, dueDate: '2026-01-01' }),
  ]

  const transactions = [
    txn({ id: 't1', invoiceId: 'i1', orderId: 'p1', amountCents: 20_000, status: 'pending' }),
  ]

  const summary = dashboardSummary(orders, invoices, transactions, at('2026-03-08'))

  it('ignores orders that are no longer active', () => {
    expect(summary.activeOrders).toBe(2)
    expect(summary.totalAgreedCents).toBe(55_000)
    // p3's long-overdue invoice must not show up once the order is closed.
    expect(summary.overdueInvoices).toBe(0)
  })

  it('separates money collected from money actually cleared', () => {
    expect(summary.collectedCents).toBe(20_000)
    expect(summary.pendingClearanceCents).toBe(20_000)
    expect(summary.payoutCents).toBe(0)
  })

  it('buckets invoices by how urgently they need chasing', () => {
    expect(summary.dueSoonInvoices).toBe(1)
  })

  it('does not let one client overpaying mask another owing', () => {
    const overpaid = [
      txn({ id: 't1', invoiceId: 'i1', orderId: 'p1', amountCents: 60_000 }),
    ]
    const withCredit = dashboardSummary(orders, invoices, overpaid, at('2026-03-08'))

    // p1 is 200 in credit, p2 owes 150. Outstanding is 150, not zero.
    expect(withCredit.outstandingCents).toBe(15_000)
  })
})

describe('date helpers', () => {
  it('counts whole days between ISO dates', () => {
    expect(daysBetween('2026-03-01', '2026-03-04')).toBe(3)
    expect(daysBetween('2026-03-04', '2026-03-01')).toBe(-3)
  })

  it('spans a month boundary', () => {
    expect(daysBetween('2026-03-29', '2026-04-01')).toBe(3)
  })

  it('formats today in local time, not UTC', () => {
    // 11pm local on the 11th must not report the 12th.
    const lateEvening = new Date(2026, 7, 11, 23, 0, 0)
    expect(todayIso(lateEvening)).toBe('2026-08-11')
  })
})

describe('invoice line items', () => {
  it('multiplies quantity by unit price', () => {
    expect(
      lineItemTotalCents({ description: 'FB Post', quantity: 4, unitPriceCents: 100_000 }),
    ).toBe(400_000)
  })

  it('treats a zero rate as an included line, not an error', () => {
    expect(
      lineItemTotalCents({ description: 'Tute Inner Setup', quantity: 1, unitPriceCents: 0 }),
    ).toBe(0)
  })

  it('rounds a fractional quantity to whole cents', () => {
    // 2.5 hours at Rs 33.33 -> 83.325 -> 83.33
    expect(
      lineItemTotalCents({ description: 'Retouching', quantity: 2.5, unitPriceCents: 3_333 }),
    ).toBe(8_333)
  })

  it('sums the sample invoice to its printed total', () => {
    const lines = [
      { description: 'Leaflet Design Results', quantity: 1, unitPriceCents: 500_000 },
      { description: 'FB Post', quantity: 4, unitPriceCents: 100_000 },
      { description: 'Reload (2026.08.04)', quantity: 1, unitPriceCents: 127_800 },
      { description: 'Tute Cover Design', quantity: 1, unitPriceCents: 200_000 },
      { description: 'Tute Inner Setup', quantity: 1, unitPriceCents: 0 },
    ]

    // Rs 12,278.00 — the figure on the Creative Paradise invoice.
    expect(lineItemsTotalCents(lines)).toBe(1_227_800)
  })

  it('sums to zero for no lines', () => {
    expect(lineItemsTotalCents([])).toBe(0)
  })
})

describe('order delivery dates', () => {
  const withDue = (over: Partial<Order> & { id: string }) =>
    order({ dueDate: '2026-09-10', ...over })

  it('is overdue once the promised date has passed', () => {
    expect(deliveryBucket(withDue({ id: 'o1' }), at('2026-09-11'))).toBe('overdue')
  })

  it('warns within the week, quiet before that', () => {
    expect(deliveryBucket(withDue({ id: 'o1' }), at('2026-09-04'))).toBe('due_soon')
    expect(deliveryBucket(withDue({ id: 'o1' }), at('2026-09-02'))).toBe('upcoming')
  })

  it('counts the due date itself as due, not overdue', () => {
    expect(deliveryBucket(withDue({ id: 'o1' }), at('2026-09-10'))).toBe('due_soon')
  })

  it('stays quiet for an order with no promised date', () => {
    expect(deliveryBucket(order({ id: 'o1' }), at('2026-09-11'))).toBe('none')
  })

  it('stops chasing once the order is completed or cancelled', () => {
    expect(
      deliveryBucket(withDue({ id: 'o1', status: 'completed' }), at('2026-09-11')),
    ).toBe('none')
    expect(
      deliveryBucket(withDue({ id: 'o1', status: 'cancelled' }), at('2026-09-11')),
    ).toBe('none')
  })

  it('is independent of whether the order is paid', () => {
    // Paid in full, but still not delivered — the money side must not silence
    // the delivery warning.
    const o = withDue({ id: 'o1', agreedAmountCents: 10_000 })
    const paid = [txn({ id: 't1', orderId: 'o1', amountCents: 10_000 })]

    expect(orderTotals(o, [], paid).status).toBe('fully_paid')
    expect(deliveryBucket(o, at('2026-09-11'))).toBe('overdue')
  })
})

describe('dashboard delivery counts', () => {
  const orders = [
    order({ id: 'o1', dueDate: '2026-09-01' }),
    order({ id: 'o2', dueDate: '2026-09-12' }),
    order({ id: 'o3', dueDate: '2026-10-30' }),
    order({ id: 'o4' }),
    order({ id: 'o5', dueDate: '2026-09-01', status: 'completed' }),
  ]

  const summary = dashboardSummary(orders, [], [], at('2026-09-08'))

  it('counts overdue and imminent deliveries, ignoring the rest', () => {
    expect(summary.overdueDeliveries).toBe(1)
    expect(summary.deliveriesDueSoon).toBe(1)
  })

  it('does not count a completed order as an overdue delivery', () => {
    expect(summary.activeOrders).toBe(4)
  })
})

describe('order lifecycle', () => {
  it('counts every open stage toward the active ledger', () => {
    const open = OPEN_ORDER_STATUSES.map((status, i) =>
      order({ id: `o${i}`, status, agreedAmountCents: 10_000 }),
    )
    const summary = dashboardSummary(open, [], [], at('2026-09-08'))

    expect(summary.activeOrders).toBe(5)
    expect(summary.outstandingCents).toBe(50_000)
  })

  it('drops completed and cancelled orders out of the totals', () => {
    const orders = [
      order({ id: 'o1', status: 'started', agreedAmountCents: 10_000 }),
      order({ id: 'o2', status: 'completed', agreedAmountCents: 99_000 }),
      order({ id: 'o3', status: 'cancelled', agreedAmountCents: 99_000 }),
    ]
    const summary = dashboardSummary(orders, [], [], at('2026-09-08'))

    expect(summary.activeOrders).toBe(1)
    expect(summary.outstandingCents).toBe(10_000)
  })

  it('chases a delivery date only while the work is still outstanding', () => {
    const late = (status: OrderStatus) =>
      deliveryBucket(order({ id: 'o1', status, dueDate: '2026-09-01' }), at('2026-09-08'))

    expect(late('initial')).toBe('overdue')
    expect(late('confirmed')).toBe('overdue')
    expect(late('started')).toBe('overdue')
    // Handed over — the deadline was met, whatever the money is doing.
    expect(late('delivered')).toBe('none')
    expect(late('payment_pending')).toBe('none')
    expect(late('completed')).toBe('none')
  })

  it('still counts a delivered but unpaid order as money outstanding', () => {
    const o = order({ id: 'o1', status: 'payment_pending', agreedAmountCents: 20_000 })
    const summary = dashboardSummary([o], [], [], at('2026-09-08'))

    expect(summary.outstandingCents).toBe(20_000)
    expect(summary.overdueDeliveries).toBe(0)
  })
})

describe('normaliseOrderStatus', () => {
  it('maps the pre-lifecycle "active" value forward', () => {
    expect(normaliseOrderStatus('active')).toBe('confirmed')
  })

  it('passes through a value that is already valid', () => {
    expect(normaliseOrderStatus('delivered')).toBe('delivered')
    expect(normaliseOrderStatus('cancelled')).toBe('cancelled')
  })

  it('falls back to the first stage for anything unrecognised', () => {
    expect(normaliseOrderStatus('nonsense')).toBe('initial')
    expect(normaliseOrderStatus('')).toBe('initial')
  })
})

describe('order deadline instant', () => {
  it('defaults to the very end of the day when no time is set', () => {
    const due = orderDueAt({ dueDate: '2026-09-10' })
    expect(due?.getHours()).toBe(23)
    expect(due?.getMinutes()).toBe(59)
  })

  it('uses the time of day when one is set', () => {
    const due = orderDueAt({ dueDate: '2026-09-10', dueTime: '14:30' })
    expect(due?.getHours()).toBe(14)
    expect(due?.getMinutes()).toBe(30)
  })

  it('is null without a date', () => {
    expect(orderDueAt({})).toBeNull()
  })

  it('is not late at 9am on a date-only deadline', () => {
    // The bug this guards: treating a bare date as midnight would mark every
    // such order overdue the moment the day began.
    const o = order({ id: 'o1', dueDate: '2026-09-10' })
    expect(deliveryBucket(o, at('2026-09-10', 9))).toBe('due_soon')
    expect(deliveryBucket(o, at('2026-09-11', 0, 1))).toBe('overdue')
  })

  it('goes late once the set time passes, same day', () => {
    const o = order({ id: 'o1', dueDate: '2026-09-10', dueTime: '14:30' })
    expect(deliveryBucket(o, at('2026-09-10', 14, 29))).toBe('due_soon')
    expect(deliveryBucket(o, at('2026-09-10', 14, 31))).toBe('overdue')
  })
})

describe('countdown formatting', () => {
  const hour = 60 * 60 * 1000
  const day = 24 * hour

  it('shows days and hours when more than a day remains', () => {
    expect(formatDuration(3 * day + 5 * hour)).toBe('3d 5h')
  })

  it('shows hours and minutes under a day', () => {
    expect(formatDuration(5 * hour + 12 * 60_000)).toBe('5h 12m')
  })

  it('shows seconds only under an hour, where they matter', () => {
    expect(formatDuration(42 * 60_000 + 18_000)).toBe('42m 18s')
    expect(formatDuration(9_000)).toBe('9s')
  })

  it('never shows more than two units', () => {
    expect(formatDuration(day + hour + 60_000 + 1_000)).toBe('1d 1h')
  })

  it('marks a passed deadline as late rather than negative', () => {
    expect(formatRemaining(-(2 * day + 4 * hour))).toBe('2d 4h late')
    expect(formatRemaining(-30_000)).toBe('30s late')
  })

  it('treats the exact moment of the deadline as late, not remaining', () => {
    expect(formatRemaining(0)).toBe('0s late')
  })

  it('counts down against a real deadline', () => {
    const o = order({ id: 'o1', dueDate: '2026-09-10', dueTime: '17:00' })
    const left = remainingMs(o, at('2026-09-10', 15, 30))

    expect(left).toBe(90 * 60_000)
    expect(formatRemaining(left!)).toBe('1h 30m')
  })
})

describe('client statement', () => {
  const orders = [
    order({ id: 'o1', clientId: 'c1', title: 'Leaflet', status: 'started' }),
    order({ id: 'o2', clientId: 'c1', title: 'FB Posts', status: 'delivered' }),
    order({ id: 'o3', clientId: 'c1', title: 'Dead job', status: 'cancelled' }),
    order({ id: 'o4', clientId: 'c1', title: 'Old job', status: 'completed' }),
    order({ id: 'o9', clientId: 'other', title: 'Someone else', status: 'started' }),
  ]

  const invoices = [
    invoice({ id: 'i1', orderId: 'o1', clientId: 'c1', amountDueCents: 50_000, dueDate: '2026-09-01' }),
    invoice({ id: 'i2', orderId: 'o2', clientId: 'c1', amountDueCents: 40_000, dueDate: '2026-09-20' }),
    invoice({ id: 'i3', orderId: 'o3', clientId: 'c1', amountDueCents: 99_000, dueDate: '2026-09-05' }),
    invoice({ id: 'i4', orderId: 'o4', clientId: 'c1', amountDueCents: 20_000, dueDate: '2026-07-01' }),
    invoice({ id: 'i9', orderId: 'o9', clientId: 'other', amountDueCents: 70_000, dueDate: '2026-09-01' }),
  ]

  const transactions = [
    txn({ id: 't1', invoiceId: 'i1', orderId: 'o1', clientId: 'c1', amountCents: 20_000, paidOn: '2026-08-15' }),
    txn({ id: 't2', invoiceId: 'i4', orderId: 'o4', clientId: 'c1', amountCents: 20_000, paidOn: '2026-07-02' }),
    txn({ id: 't9', invoiceId: 'i9', orderId: 'o9', clientId: 'other', amountCents: 70_000 }),
  ]

  const statement = clientStatement('c1', orders, invoices, transactions, '2026-09-10')

  it('covers only this client', () => {
    expect(statement.lines.every((l) => l.invoice.clientId === 'c1')).toBe(true)
    expect(statement.payments.every((p) => p.clientId === 'c1')).toBe(true)
  })

  it('leaves out cancelled work entirely', () => {
    // Billing a client for a job you cancelled is the worst kind of error here.
    expect(statement.lines.map((l) => l.invoice.id)).not.toContain('i3')
  })

  it('leaves out a settled, closed order', () => {
    expect(statement.lines.map((l) => l.invoice.id)).not.toContain('i4')
  })

  it('shows both what is owed and what has been paid', () => {
    expect(statement.totalInvoicedCents).toBe(90_000)
    expect(statement.totalPaidCents).toBe(20_000)
    expect(statement.balanceDueCents).toBe(70_000)
  })

  it('lists the payments already made against the included work', () => {
    expect(statement.payments.map((p) => p.id)).toEqual(['t1'])
  })

  it('counts what is overdue', () => {
    expect(statement.overdueCount).toBe(1)
  })

  it('orders lines by due date, oldest debt first', () => {
    expect(statement.lines.map((l) => l.invoice.id)).toEqual(['i1', 'i2'])
  })

  it('still bills a closed order that was never fully paid', () => {
    const partlyPaid = transactions.filter((t) => t.id !== 't2')
    const result = clientStatement('c1', orders, invoices, partlyPaid, '2026-09-10')

    expect(result.lines.map((l) => l.invoice.id)).toContain('i4')
  })

  it('is empty for a client with nothing outstanding', () => {
    const result = clientStatement('nobody', orders, invoices, transactions, '2026-09-10')

    expect(result.lines).toEqual([])
    expect(result.balanceDueCents).toBe(0)
  })
})
