import { describe, expect, it } from 'vitest'

import {
  addDays,
  initialInvoices,
  monthLabel,
  nextRetainerInvoice,
  startOfMonth,
} from './invoicing'
import type { Invoice } from '../types/domain'

const order = {
  id: 'p1',
  clientId: 'c1',
  agreedAmountCents: 30_000,
}

function invoice(over: Partial<Invoice> & { id: string }): Invoice {
  return {
    ownerId: 'o1',
    createdAt: 0,
    orderId: 'p1',
    clientId: 'c1',
    label: 'Invoice',
    amountDueCents: 30_000,
    dueDate: '2026-03-01',
    ...over,
  }
}

describe('date arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-03-28', 7)).toBe('2026-04-04')
  })

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('finds the start of this and later months', () => {
    expect(startOfMonth('2026-03-17')).toBe('2026-03-01')
    expect(startOfMonth('2026-11-17', 2)).toBe('2027-01-01')
  })

  it('labels a period key readably', () => {
    expect(monthLabel('2026-03')).toBe('March 2026')
  })
})

describe('initialInvoices', () => {
  it('splits a fixed order into an advance and a balance', () => {
    const drafts = initialInvoices(
      { ...order, billingType: 'fixed_split', agreedAmountCents: 40_000 },
      '2026-03-01',
    )

    expect(drafts).toHaveLength(2)
    expect(drafts[0].amountDueCents).toBe(20_000)
    expect(drafts[1].amountDueCents).toBe(20_000)
    expect(drafts[1].dueDate).toBe('2026-03-08')
  })

  it('splits an odd total without losing a cent', () => {
    const drafts = initialInvoices(
      { ...order, billingType: 'fixed_split', agreedAmountCents: 15_001 },
      '2026-03-01',
    )

    const total = drafts.reduce((sum, d) => sum + d.amountDueCents, 0)
    expect(total).toBe(15_001)
  })

  it('raises the current month for a retainer', () => {
    const [draft] = initialInvoices(
      { ...order, billingType: 'monthly_retainer' },
      '2026-03-17',
    )

    expect(draft.periodKey).toBe('2026-03')
    expect(draft.dueDate).toBe('2026-03-01')
    expect(draft.amountDueCents).toBe(30_000)
  })

  it('raises one invoice for pay-on-delivery', () => {
    const drafts = initialInvoices(
      { ...order, billingType: 'on_delivery' },
      '2026-03-01',
    )

    expect(drafts).toHaveLength(1)
    expect(drafts[0].amountDueCents).toBe(30_000)
  })

  it('raises nothing for a milestone order', () => {
    expect(
      initialInvoices({ ...order, billingType: 'milestone' }, '2026-03-01'),
    ).toEqual([])
  })
})

describe('nextRetainerInvoice', () => {
  it('bills the current month when nothing has been raised', () => {
    const draft = nextRetainerInvoice(order, [], '2026-03-17')
    expect(draft?.periodKey).toBe('2026-03')
  })

  it('moves to next month once this one is raised', () => {
    const existing = [invoice({ id: 'i1', periodKey: '2026-03' })]
    const draft = nextRetainerInvoice(order, existing, '2026-03-17')

    expect(draft?.periodKey).toBe('2026-04')
    expect(draft?.dueDate).toBe('2026-04-01')
  })

  it('catches up a month the freelancer forgot to bill', () => {
    // April was raised but March never was — March should still be billed.
    const existing = [invoice({ id: 'i1', periodKey: '2026-04' })]
    const draft = nextRetainerInvoice(order, existing, '2026-03-17')

    expect(draft?.periodKey).toBe('2026-03')
  })

  it('ignores invoices belonging to a different order', () => {
    const existing = [
      invoice({ id: 'i1', orderId: 'other', periodKey: '2026-03' }),
    ]
    const draft = nextRetainerInvoice(order, existing, '2026-03-17')

    expect(draft?.periodKey).toBe('2026-03')
  })
})
