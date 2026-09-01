/**
 * WhatsApp message composition.
 *
 * Phase 1 has no WhatsApp Business API. A wa.me link needs no integration,
 * no account and no budget: it opens the freelancer's own WhatsApp with the
 * message pre-filled, and they press send. Phase 2 can swap the transport
 * without changing the wording, which is why the message builders live here
 * rather than inline in the components.
 */

import { formatCents } from './money'
import type { Client, Invoice, Order, Transaction } from '../types/domain'
import type { ClientStatement } from './calc'

/**
 * Default country code used to expand nationally-formatted numbers.
 * Sri Lanka (+94). Change this one line if the freelancer's client base moves.
 */
export const DEFAULT_COUNTRY_CODE = '94'

/**
 * Reduce a phone number to the digits `wa.me` expects: full international
 * format, no '+', no separators, no leading zero.
 *
 * This is fussier than it looks, and getting it wrong is why WhatsApp reports
 * "This link couldn't be opened" rather than anything diagnostic:
 *
 *   '+94 77 123 4567'  -> '94771234567'  (separators and '+' dropped)
 *   '0094771234567'    -> '94771234567'  ('00' international prefix dropped)
 *   '0771234567'       -> '94771234567'  (national trunk '0' -> country code)
 *
 * The trunk-prefix case is the one that bites: a number copied straight out of
 * a local contact list starts with 0, which wa.me reads as an invalid country
 * code and refuses outright.
 */
export function normalisePhone(
  input: string,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string {
  const digits = input.replace(/\D/g, '')
  if (digits === '') return ''

  // '00' is the international dialling prefix — everything after it is already
  // a country code.
  if (digits.startsWith('00')) return digits.slice(2)

  // A single leading zero is a national trunk prefix; swap it for the country
  // code. Without this the link is silently broken.
  if (digits.startsWith('0')) return countryCode + digits.slice(1)

  return digits
}

/**
 * Whether a normalised number stands a chance of resolving. E.164 allows at
 * most 15 digits, and no real number is shorter than about 8 once the country
 * code is included.
 */
export function isUsableWhatsAppNumber(input: string): boolean {
  const digits = normalisePhone(input)
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')
}

export function waLink(phone: string, message: string): string {
  return `https://wa.me/${normalisePhone(phone)}?text=${encodeURIComponent(message)}`
}

/** "Here's what you owe" — the manual stand-in for an automated invoice. */
export function invoiceRequestMessage(
  client: Client,
  order: Order,
  invoice: Invoice,
  balanceCents: number,
): string {
  const lines = [
    // Full name, not a first name: most clients here are businesses, and
    // "Hi Burger," is worse than "Hi Burger Craft,".
    `Hi ${client.name},`,
    '',
    `Invoice for *${order.title}* — ${invoice.label}.`,
    `Amount due: *${formatCents(invoice.amountDueCents)}*`,
  ]

  if (balanceCents !== invoice.amountDueCents) {
    lines.push(`Outstanding on this invoice: *${formatCents(balanceCents)}*`)
  }

  lines.push(`Due by ${formatDateForHumans(invoice.dueDate)}.`, '', 'Thank you!')

  return lines.join('\n')
}

/** The thank-you receipt card, sent by hand after logging a payment. */
export function receiptMessage(
  client: Client,
  order: Order,
  transaction: Transaction,
  remainingCents: number,
): string {
  const lines = [
    // Full name, not a first name: most clients here are businesses, and
    // "Hi Burger," is worse than "Hi Burger Craft,".
    `Hi ${client.name},`,
    '',
    `Received ${formatCents(transaction.amountCents)} for *${order.title}* — thank you!`,
    `Payment date: ${formatDateForHumans(transaction.paidOn)}`,
  ]

  lines.push(
    remainingCents > 0
      ? `Remaining balance: *${formatCents(remainingCents)}*`
      : 'Your account is fully settled. 🎉',
  )

  return lines.join('\n')
}

/**
 * A payment request covering the client's whole account: what has been paid,
 * what is still outstanding, and the balance.
 *
 * Sending one of these beats sending three separate invoice requests to a
 * client with three orders running — they see the relationship, not fragments
 * of it, and there is one number to pay.
 */
export function statementRequestMessage(
  client: Client,
  statement: ClientStatement,
  orders: Order[],
): string {
  const outstanding = statement.lines.filter((line) => line.balanceCents > 0)
  const titleOf = (orderId: string) =>
    orders.find((o) => o.id === orderId)?.title ?? 'Work'

  const lines = [`Hi ${client.name},`, '', 'Here is a summary of your account.']

  if (statement.totalPaidCents > 0) {
    lines.push('', `Received so far: *${formatCents(statement.totalPaidCents)}* — thank you.`)
  }

  if (outstanding.length > 0) {
    lines.push('', 'Still outstanding:')
    for (const line of outstanding) {
      const overdue = line.bucket === 'overdue' ? ' (overdue)' : ''
      lines.push(
        `• ${titleOf(line.invoice.orderId)} — ${line.invoice.label}: ${formatCents(line.balanceCents)}${overdue}`,
      )
    }
    lines.push('', `*Total due: ${formatCents(statement.balanceDueCents)}*`)
  } else {
    lines.push('', 'Everything is settled — nothing outstanding. 🎉')
  }

  lines.push('', 'Let me know if you would like a detailed invoice.')

  return lines.join('\n')
}

/** A nudge for an invoice that is late or nearly due. */
export function reminderMessage(
  client: Client,
  order: Order,
  invoice: Invoice,
  balanceCents: number,
  isOverdue: boolean,
): string {
  const opener = isOverdue
    ? `Just a gentle reminder that the payment for *${order.title}* was due on ${formatDateForHumans(invoice.dueDate)}.`
    : `A quick heads-up that the payment for *${order.title}* is due on ${formatDateForHumans(invoice.dueDate)}.`

  return [
    // Full name, not a first name: most clients here are businesses, and
    // "Hi Burger," is worse than "Hi Burger Craft,".
    `Hi ${client.name},`,
    '',
    opener,
    `Outstanding: *${formatCents(balanceCents)}* (${invoice.label})`,
    '',
    'Let me know if you need anything from my side.',
  ].join('\n')
}

/** '2026-03-01' -> '1 March 2026'. */
export function formatDateForHumans(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate

  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
