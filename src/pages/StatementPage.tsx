import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useWorkspace } from '../data/WorkspaceProvider'
import { clientStatement, todayIso } from '../lib/calc'
import { formatCentsPlain } from '../lib/money'
import {
  formatDateForHumans,
  isUsableWhatsAppNumber,
  statementRequestMessage,
  waLink,
} from '../lib/whatsapp'
import { EmptyState, WhatsAppButton } from '../components/ui'
import { PAYMENT_METHOD_LABELS } from '../types/domain'

/**
 * A client's whole account on one printable sheet: every outstanding invoice
 * across every order, every payment received, and one balance to settle.
 *
 * Deliberately a client-level document rather than a per-invoice one. Once a
 * client has several orders running, sending three separate invoice requests
 * asks them to do the adding up.
 */
export function StatementPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const { clients, orders, invoices, transactions, profile, loading } =
    useWorkspace()

  const today = todayIso()
  const client = clients.find((c) => c.id === clientId)

  const statement = useMemo(
    () =>
      clientId
        ? clientStatement(clientId, orders, invoices, transactions, today)
        : null,
    [clientId, orders, invoices, transactions, today],
  )

  const titleOf = (orderId: string) =>
    orders.find((o) => o.id === orderId)?.title ?? '—'

  if (loading) {
    return <div className="page"><div className="empty">Loading…</div></div>
  }

  if (!client || !statement) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState>
            That client no longer exists. <Link to="/clients">Back to clients</Link>
          </EmptyState>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="print-toolbar">
        <Link className="btn btn--sm" to="/clients">
          ← Back to clients
        </Link>
        <span className="muted">
          Print this, or send the summary on WhatsApp.
        </span>
        {isUsableWhatsAppNumber(client.whatsapp) && (
          <WhatsAppButton
            label="Send payment request"
            href={waLink(
              client.whatsapp,
              statementRequestMessage(client, statement, orders),
            )}
          />
        )}
        <button className="btn--primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <article className="sheet">
        <header className="sheet__banner">
          <h1>{profile?.businessName || 'Your business name'}</h1>
          {profile?.tagline && <p>{profile.tagline}</p>}
        </header>

        <div className="sheet__meta">
          <div className="sheet__brand">Statement of account</div>
          <dl className="sheet__contact">
            {profile?.email && (
              <>
                <dt>Mail</dt>
                <dd>{profile.email}</dd>
              </>
            )}
            {profile?.mobile && (
              <>
                <dt>Mobile</dt>
                <dd>{profile.mobile}</dd>
              </>
            )}
            <dt>Date</dt>
            <dd>{formatDateForHumans(today)}</dd>
          </dl>
        </div>

        <div className="sheet__addressee">
          <span>M/S</span>
          <strong>{client.name}</strong>
        </div>

        {statement.lines.length === 0 ? (
          <p className="sheet__thanks">
            Nothing outstanding — this account is fully settled.
          </p>
        ) : (
          <>
            <table className="sheet__items sheet__items--auto">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Invoice</th>
                  <th className="col-rate">Due</th>
                  <th className="col-rate">Amount</th>
                  <th className="col-rate">Paid</th>
                  <th className="col-amount">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((line) => (
                  <tr key={line.invoice.id}>
                    <td>{titleOf(line.invoice.orderId)}</td>
                    <td>{line.invoice.label}</td>
                    <td className="col-rate">
                      {formatDateForHumans(line.invoice.dueDate)}
                      {line.bucket === 'overdue' && ' *'}
                    </td>
                    <td className="col-rate">
                      {formatCentsPlain(line.invoice.amountDueCents)}
                    </td>
                    <td className="col-rate">
                      {line.paidCents > 0 ? formatCentsPlain(line.paidCents) : '-'}
                    </td>
                    <td className="col-amount">
                      {line.balanceCents > 0
                        ? formatCentsPlain(line.balanceCents)
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="row-total">
                  <td colSpan={5}>Total invoiced</td>
                  <td className="col-amount">
                    {formatCentsPlain(statement.totalInvoicedCents)}
                  </td>
                </tr>
                <tr className="row-paid">
                  <td colSpan={5}>Paid</td>
                  <td className="col-amount">
                    {formatCentsPlain(statement.totalPaidCents)}
                  </td>
                </tr>
                <tr className="row-balance">
                  <td colSpan={5}>Balance due</td>
                  <td className="col-amount">
                    {formatCentsPlain(Math.max(statement.balanceDueCents, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>

            {statement.overdueCount > 0 && (
              <p className="sheet__note">
                * overdue —{' '}
                {statement.overdueCount === 1
                  ? '1 invoice is'
                  : `${statement.overdueCount} invoices are`}{' '}
                past the due date.
              </p>
            )}
          </>
        )}

        {statement.payments.length > 0 && (
          <>
            <h2 className="sheet__section">Payments received</h2>
            <table className="sheet__items sheet__items--auto">
              <thead>
                <tr>
                  <th className="col-rate">Date</th>
                  <th>Against</th>
                  <th>Method</th>
                  <th className="col-amount">Amount</th>
                </tr>
              </thead>
              <tbody>
                {statement.payments.map((payment) => {
                  const against = invoices.find((i) => i.id === payment.invoiceId)
                  return (
                    <tr key={payment.id}>
                      <td className="col-rate">
                        {formatDateForHumans(payment.paidOn)}
                      </td>
                      <td>
                        {titleOf(payment.orderId)}
                        {against ? ` — ${against.label}` : ''}
                      </td>
                      <td>
                        {PAYMENT_METHOD_LABELS[payment.method]}
                        {payment.reference ? ` · ${payment.reference}` : ''}
                      </td>
                      <td className="col-amount">
                        {formatCentsPlain(payment.amountCents)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        {profile?.thankYouNote && (
          <p className="sheet__thanks">{profile.thankYouNote}</p>
        )}

        {profile?.footerNote && (
          <footer className="sheet__footer">{profile.footerNote}</footer>
        )}
      </article>
    </>
  )
}
