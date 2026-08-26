import { describe, expect, it } from 'vitest'

import {
  formatDateForHumans,
  invoiceRequestMessage,
  isUsableWhatsAppNumber,
  normalisePhone,
  receiptMessage,
  waLink,
} from './whatsapp'
import type { Client, Invoice, Order, Transaction } from '../types/domain'

const client: Client = {
  id: 'c1',
  ownerId: 'o1',
  createdAt: 0,
  name: 'Burger Craft',
  whatsapp: '94771234567',
}

const order: Order = {
  id: 'p1',
  ownerId: 'o1',
  createdAt: 0,
  clientId: 'c1',
  title: 'Menu Design & Banner Printing',
  billingType: 'fixed_split',
  agreedAmountCents: 40_000,
  commissionRate: 0,
  status: 'active',
}

const invoice: Invoice = {
  id: 'i1',
  ownerId: 'o1',
  createdAt: 0,
  orderId: 'p1',
  clientId: 'c1',
  label: 'Balance on delivery',
  amountDueCents: 20_000,
  dueDate: '2026-08-18',
}

const transaction: Transaction = {
  id: 't1',
  ownerId: 'o1',
  createdAt: 0,
  invoiceId: 'i1',
  orderId: 'p1',
  clientId: 'c1',
  amountCents: 20_000,
  paidOn: '2026-08-11',
  method: 'bank_transfer',
  status: 'cleared',
}

describe('normalisePhone', () => {
  it('strips punctuation and the plus sign', () => {
    expect(normalisePhone('+94 77 123 4567')).toBe('94771234567')
    expect(normalisePhone('(077) 123-4567')).toBe('94771234567')
  })

  it('drops the 00 international dialling prefix', () => {
    expect(normalisePhone('0094771234567')).toBe('94771234567')
  })

  it('swaps a national trunk zero for the country code', () => {
    // The bug behind WhatsApp's "This link couldn't be opened": a number
    // copied from a local contact list starts with 0, which wa.me rejects.
    expect(normalisePhone('0771234567')).toBe('94771234567')
  })

  it('leaves an already-international number alone', () => {
    expect(normalisePhone('94771234567')).toBe('94771234567')
  })

  it('honours a different country code', () => {
    expect(normalisePhone('07700900123', '44')).toBe('447700900123')
  })

  it('returns empty for empty input rather than a bare country code', () => {
    expect(normalisePhone('')).toBe('')
    expect(normalisePhone('   ')).toBe('')
  })
})

describe('isUsableWhatsAppNumber', () => {
  it('accepts plausible international numbers', () => {
    expect(isUsableWhatsAppNumber('94771234567')).toBe(true)
    expect(isUsableWhatsAppNumber('0771234567')).toBe(true)
  })

  it('rejects empty, too-short, and over-length numbers', () => {
    expect(isUsableWhatsAppNumber('')).toBe(false)
    expect(isUsableWhatsAppNumber('12345')).toBe(false)
    expect(isUsableWhatsAppNumber('1234567890123456')).toBe(false)
  })
})

describe('waLink', () => {
  it('never emits a leading zero in the phone segment', () => {
    const url = new URL(waLink('0771234567', 'hi'))
    expect(url.pathname).toBe('/94771234567')
  })

  it('produces a parseable URL and round-trips the message intact', () => {
    const message = invoiceRequestMessage(client, order, invoice, 20_000)
    const url = new URL(waLink(client.whatsapp, message))

    expect(url.origin).toBe('https://wa.me')
    // The ampersand in the order title must not split the query string.
    expect(url.searchParams.get('text')).toBe(message)
  })

  it('encodes the characters that would otherwise break the query string', () => {
    const raw = waLink('94771234567', 'a & b = c #d +e')
    expect(raw).toContain('%26')
    expect(raw).toContain('%3D')
    expect(raw).toContain('%23')
    expect(raw).toContain('%2B')
  })

  it('encodes newlines rather than emitting literal line breaks', () => {
    expect(waLink('94771234567', 'one\ntwo')).toContain('%0A')
  })
})

describe('message wording', () => {
  it('greets the client by full name, not a first word', () => {
    const message = invoiceRequestMessage(client, order, invoice, 20_000)
    expect(message).toContain('Hi Burger Craft,')
  })

  it('states the amount and a human-readable due date', () => {
    const message = invoiceRequestMessage(client, order, invoice, 20_000)
    expect(message).toContain('Rs 200.00')
    expect(message).toContain('18 August 2026')
  })

  it('reports the outstanding balance separately after a part payment', () => {
    const message = invoiceRequestMessage(client, order, invoice, 5_000)
    expect(message).toContain('Outstanding on this invoice: *Rs 50.00*')
  })

  it('tells the client they are settled when nothing remains', () => {
    const message = receiptMessage(client, order, transaction, 0)
    expect(message).toContain('fully settled')
    expect(message).not.toContain('Remaining balance')
  })

  it('states the remaining balance when money is still owed', () => {
    const message = receiptMessage(client, order, transaction, 20_000)
    expect(message).toContain('Remaining balance: *Rs 200.00*')
  })
})

describe('formatDateForHumans', () => {
  it('renders an ISO date readably', () => {
    expect(formatDateForHumans('2026-08-18')).toBe('18 August 2026')
  })

  it('passes through anything that is not a full ISO date', () => {
    expect(formatDateForHumans('not-a-date')).toBe('not-a-date')
  })
})
