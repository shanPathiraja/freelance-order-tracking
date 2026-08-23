import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useWorkspace } from '../data/WorkspaceProvider'
import { invoiceTotals, lineItemTotalCents } from '../lib/calc'
import { formatCentsPlain } from '../lib/money'
import { formatDateForHumans } from '../lib/whatsapp'
import { EmptyState } from '../components/ui'
import type { InvoiceLineItem } from '../types/domain'

/** Blank rows padded to this many, so every invoice prints the same height. */
const MIN_ROWS = 12

/**
 * A print-ready invoice, laid out to match the Creative Paradise sheet.
 *
 * Everything here is driven by @media print in index.css: on screen it sits on
 * the app background with a toolbar, and printing drops the toolbar and fills
 * an A4 page. No PDF library — the browser's own print dialog does the export.
 */
export function InvoicePrintPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>()
  const { clients, projects, invoices, transactions, profile, loading } =
    useWorkspace()

  const invoice = invoices.find((i) => i.id === invoiceId)
  const project = projects.find((p) => p.id === invoice?.projectId)
  const client = clients.find((c) => c.id === invoice?.clientId)

  const totals = useMemo(
    () => (invoice ? invoiceTotals(invoice, transactions) : null),
    [invoice, transactions],
  )

  /**
   * An invoice with no itemised breakdown still prints as a table, using its
   * label as the single line — that keeps auto-generated invoices (a 50/50
   * split, a retainer month) printable without special-casing the layout.
   */
  const lines: InvoiceLineItem[] = useMemo(() => {
    if (!invoice) return []
    if (invoice.lineItems?.length) return invoice.lineItems
    return [
      {
        description: invoice.label,
        quantity: 1,
        unitPriceCents: invoice.amountDueCents,
      },
    ]
  }, [invoice])

  if (loading) {
    return <div className="page"><div className="empty">Loading…</div></div>
  }

  if (!invoice || !totals) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState>
            That invoice no longer exists. <Link to="/">Back to dashboard</Link>
          </EmptyState>
        </div>
      </div>
    )
  }

  const blankRows = Math.max(0, MIN_ROWS - lines.length)

  return (
    <>
      <div className="print-toolbar">
        <Link className="btn btn--sm" to={`/projects/${invoice.projectId}`}>
          ← Back to project
        </Link>
        <span className="muted">
          Use your browser's print dialog to save this as a PDF.
        </span>
        <button className="btn--primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      {!profile?.businessName && (
        <div className="print-toolbar print-toolbar--warn">
          Your business details are not set yet, so the header will be blank.{' '}
          <Link className="row-link" to="/settings">
            Add them in Settings
          </Link>
          .
        </div>
      )}

      <article className="sheet">
        <header className="sheet__banner">
          <h1>{profile?.businessName || 'Your business name'}</h1>
          {profile?.tagline && <p>{profile.tagline}</p>}
        </header>

        <div className="sheet__meta">
          <div className="sheet__brand">{profile?.businessName}</div>
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
            {profile?.website && (
              <>
                <dt>Web</dt>
                <dd>{profile.website}</dd>
              </>
            )}
            {profile?.facebook && (
              <>
                <dt>FB</dt>
                <dd>{profile.facebook}</dd>
              </>
            )}
            <dt>Date</dt>
            <dd>{formatDateForHumans(invoice.dueDate)}</dd>
          </dl>
        </div>

        <div className="sheet__addressee">
          <span>M/S</span>
          <strong>{client?.name ?? '—'}</strong>
        </div>

        {project && <div className="sheet__project">{project.title}</div>}

        <table className="sheet__items">
          <thead>
            <tr>
              <th className="col-qty">Qty</th>
              <th>Description</th>
              <th className="col-rate">Rate</th>
              <th className="col-amount">Rs</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td className="col-qty">{line.quantity}</td>
                <td>{line.description}</td>
                <td className="col-rate">
                  {line.unitPriceCents > 0
                    ? formatCentsPlain(line.unitPriceCents)
                    : ''}
                </td>
                <td className="col-amount">
                  {lineItemTotalCents(line) > 0
                    ? formatCentsPlain(lineItemTotalCents(line))
                    : '-'}
                </td>
              </tr>
            ))}
            {Array.from({ length: blankRows }, (_, i) => (
              <tr key={`blank-${i}`} className="is-blank">
                <td className="col-qty" />
                <td />
                <td className="col-rate" />
                <td className="col-amount">-</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="row-total">
              <td colSpan={3}>Total</td>
              <td className="col-amount">
                {formatCentsPlain(totals.amountDueCents)}
              </td>
            </tr>
            <tr className="row-paid">
              <td colSpan={3}>Paid</td>
              <td className="col-amount">
                {totals.paidCents > 0 ? formatCentsPlain(totals.paidCents) : '-'}
              </td>
            </tr>
            <tr className="row-balance">
              <td colSpan={3}>Balance</td>
              <td className="col-amount">
                {formatCentsPlain(Math.max(totals.balanceCents, 0))}
              </td>
            </tr>
          </tfoot>
        </table>

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
