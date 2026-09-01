import { describe, expect, it } from 'vitest'

import { clientStatement } from './calc'
import { buildStatementPdf } from './statementPdf'
import type { Client, Invoice, Order, Transaction } from '../types/domain'

const client: Client = { id: 'x', ownerId: 'o', createdAt: 0, name: 'Wimala Hamuduruwoo', whatsapp: '94779447533' }

const orders: Order[] = [
  { id: 'o1', ownerId: 'o', createdAt: 0, clientId: 'x', title: 'Leaflet Design', billingType: 'fixed_split', agreedAmountCents: 500000, commissionRate: 0, status: 'started' },
  { id: 'o2', ownerId: 'o', createdAt: 0, clientId: 'x', title: 'FB Post Pack', billingType: 'fixed_split', agreedAmountCents: 400000, commissionRate: 0, status: 'confirmed' },
]

const invoices: Invoice[] = [
  { id: 'i1', ownerId: 'o', createdAt: 0, orderId: 'o1', clientId: 'x', label: '50% Advance', amountDueCents: 250000, dueDate: '2026-08-20' },
  { id: 'i2', ownerId: 'o', createdAt: 0, orderId: 'o1', clientId: 'x', label: 'Balance on delivery', amountDueCents: 250000, dueDate: '2026-09-08' },
  { id: 'i3', ownerId: 'o', createdAt: 0, orderId: 'o2', clientId: 'x', label: '50% Advance', amountDueCents: 200000, dueDate: '2026-09-10' },
  { id: 'i4', ownerId: 'o', createdAt: 0, orderId: 'o2', clientId: 'x', label: 'Balance on delivery', amountDueCents: 200000, dueDate: '2026-09-17' },
]

const transactions: Transaction[] = [
  { id: 't1', ownerId: 'o', createdAt: 0, invoiceId: 'i1', orderId: 'o1', clientId: 'x', amountCents: 250000, paidOn: '2026-08-21', method: 'bank_transfer', status: 'cleared', reference: 'BOC 4471' },
]

describe('statement PDF', () => {
  it('produces a valid single-page PDF', async () => {
    const statement = clientStatement('x', orders, invoices, transactions, '2026-09-05')
    const file = await buildStatementPdf({
      client, statement, orders, invoices,
      profile: {
        businessName: 'Creative Paradise',
        tagline: 'We will create your idea.',
        email: 'cparadise614@gmail.com',
        mobile: '0779447533',
        thankYouNote: 'Thank you for joining with us creative paradise',
        footerNote: 'Professional Graphic Designer with a Dip. in Design and over a decade of experience in designing unique and quality artwork.',
      },
      today: '2026-09-05',
    })

    const bytes = new Uint8Array(await file.arrayBuffer())
    // latin1 so the raw PDF operators survive the decode unmangled.
    const text = new TextDecoder('latin1').decode(bytes)

    expect(file.type).toBe('application/pdf')
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    // The three summary figures must actually appear in the document.
    expect(text).toContain('9,000.00')
    expect(text).toContain('2,500.00')
    expect(text).toContain('6,500.00')
    // Text, not a screenshot: the client's name must be selectable in the file.
    expect(text).toContain('Wimala Hamuduruwoo')
  })
})
