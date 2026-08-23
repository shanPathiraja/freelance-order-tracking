import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useOwnerId } from '../auth/AuthProvider'
import { useWorkspace } from '../data/WorkspaceProvider'
import * as repo from '../data/repository'
import {
  dueBucket,
  invoiceTotals,
  isRetainerClearToContinue,
  lineItemsTotalCents,
  lineItemTotalCents,
  periodKeyOf,
  projectTotals,
  todayIso,
} from '../lib/calc'
import { centsToInputValue, formatCents, parseAmountToCents } from '../lib/money'
import { addDays, nextRetainerInvoice } from '../lib/invoicing'
import {
  formatDateForHumans,
  invoiceRequestMessage,
  isUsableWhatsAppNumber,
  receiptMessage,
  waLink,
} from '../lib/whatsapp'
import {
  DuePill,
  EmptyState,
  Field,
  Modal,
  Money,
  Stat,
  StatusPill,
  WhatsAppButton,
} from '../components/ui'
import {
  BILLING_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type Invoice,
  type InvoiceLineItem,
  type PaymentMethod,
} from '../types/domain'

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const ownerId = useOwnerId()
  const { clients, projects, invoices, transactions, loading, refresh } =
    useWorkspace()

  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null)
  const [addingInvoice, setAddingInvoice] = useState(false)
  const [busy, setBusy] = useState(false)

  const today = todayIso()
  const project = projects.find((p) => p.id === projectId)
  const client = clients.find((c) => c.id === project?.clientId)

  const projectInvoices = useMemo(
    () =>
      invoices
        .filter((i) => i.projectId === projectId)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [invoices, projectId],
  )

  const totals = useMemo(
    () => (project ? projectTotals(project, invoices, transactions) : null),
    [project, invoices, transactions],
  )

  if (loading) return <div className="page"><div className="empty">Loading…</div></div>

  if (!project || !totals) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState>
            That project no longer exists. <Link to="/">Back to dashboard</Link>
          </EmptyState>
        </div>
      </div>
    )
  }

  const isRetainer = project.billingType === 'monthly_retainer'
  const retainerBlocked =
    isRetainer &&
    !isRetainerClearToContinue(periodKeyOf(today), projectInvoices, transactions)

  async function generateNextMonth() {
    if (!project) return

    const draft = nextRetainerInvoice(project, projectInvoices, today)
    if (!draft) return

    setBusy(true)
    try {
      await repo.invoices.create(ownerId, draft)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function toggleProjectStatus() {
    if (!project) return

    setBusy(true)
    try {
      await repo.projects.update(project.id, {
        status: project.status === 'active' ? 'completed' : 'active',
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>{project.title}</h1>
          <p>
            {client ? (
              <Link className="row-link" to="/clients">
                {client.name}
              </Link>
            ) : (
              'Unknown client'
            )}{' '}
            · {BILLING_TYPE_LABELS[project.billingType]}
            {project.commissionRate > 0 &&
              ` · ${Math.round(project.commissionRate * 100)}% commission`}
          </p>
        </div>
        <div className="actions">
          <button onClick={toggleProjectStatus} disabled={busy}>
            {project.status === 'active' ? 'Mark completed' : 'Reopen'}
          </button>
          {isRetainer ? (
            <button className="btn--primary" onClick={generateNextMonth} disabled={busy}>
              Generate next month
            </button>
          ) : (
            <button className="btn--primary" onClick={() => setAddingInvoice(true)}>
              Add invoice
            </button>
          )}
        </div>
      </div>

      {retainerBlocked && (
        <div className="banner banner--warn">
          A previous month is still unpaid. The scenario rules say work
          continues only while the last invoice is settled — chase it before
          starting this month.
        </div>
      )}

      <div className="stat-grid">
        <Stat
          label={isRetainer ? 'Billed to date' : 'Agreed'}
          value={formatCents(totals.committedCents)}
          hint={
            isRetainer
              ? `${formatCents(project.agreedAmountCents)} per month`
              : undefined
          }
        />
        <Stat
          label="Paid"
          value={formatCents(totals.paidCents)}
          hint={
            totals.paidCents !== totals.clearedCents
              ? `${formatCents(totals.paidCents - totals.clearedCents)} pending clearance`
              : undefined
          }
        />
        <Stat
          label="Balance"
          value={formatCents(Math.max(totals.balanceCents, 0))}
          alert={totals.balanceCents > 0}
          hint={
            totals.uninvoicedCents > 0
              ? `${formatCents(totals.uninvoicedCents)} not yet invoiced`
              : undefined
          }
        />
        <Stat
          label="Your payout"
          value={formatCents(totals.payoutCents)}
          hint="on cleared money"
        />
      </div>

      <section className="card">
        <div className="card__title">
          <h2>Invoices</h2>
          <StatusPill status={totals.status} />
        </div>

        {projectInvoices.length === 0 ? (
          <EmptyState>
            No invoices yet.{' '}
            {project.billingType === 'milestone'
              ? 'Add one for each milestone as you agree it.'
              : 'Add the first one to start billing.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Due</th>
                  <th className="num">Amount</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {projectInvoices.map((invoice) => {
                  const line = invoiceTotals(invoice, transactions)
                  const bucket = dueBucket(invoice, transactions, today)

                  return (
                    <tr key={invoice.id}>
                      <td>{invoice.label}</td>
                      <td>
                        <div className="inline-list">
                          <span>{formatDateForHumans(invoice.dueDate)}</span>
                          <DuePill bucket={bucket} />
                        </div>
                      </td>
                      <td className="num">{formatCents(invoice.amountDueCents)}</td>
                      <td className="num">{formatCents(line.paidCents)}</td>
                      <td className="num">
                        <Money cents={line.balanceCents} />
                      </td>
                      <td>
                        <StatusPill status={line.status} />
                      </td>
                      <td className="num">
                        <div className="inline-list" style={{ justifyContent: 'flex-end' }}>
                          {client &&
                            isUsableWhatsAppNumber(client.whatsapp) &&
                            line.status !== 'fully_paid' && (
                            <WhatsAppButton
                              small
                              label="Request"
                              href={waLink(
                                client.whatsapp,
                                invoiceRequestMessage(
                                  client,
                                  project,
                                  invoice,
                                  line.balanceCents,
                                ),
                              )}
                            />
                          )}
                          <Link
                            className="btn btn--sm"
                            to={`/invoices/${invoice.id}/print`}
                          >
                            Invoice
                          </Link>
                          <button
                            className="btn--sm"
                            onClick={() => setPayingInvoice(invoice)}
                          >
                            Log payment
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TransactionList projectId={project.id} />

      {payingInvoice && (
        <LogPaymentModal
          invoice={payingInvoice}
          onClose={() => setPayingInvoice(null)}
        />
      )}
      {addingInvoice && (
        <AddInvoiceModal
          project={project}
          existingCount={projectInvoices.length}
          uninvoicedCents={totals.uninvoicedCents}
          onClose={() => setAddingInvoice(false)}
        />
      )}
    </div>
  )
}

function TransactionList({ projectId }: { projectId: string }) {
  const { transactions, clients, projects, invoices, refresh } = useWorkspace()
  const [busyId, setBusyId] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      transactions
        .filter((t) => t.projectId === projectId)
        .sort((a, b) => b.paidOn.localeCompare(a.paidOn)),
    [transactions, projectId],
  )

  const project = projects.find((p) => p.id === projectId)
  const client = clients.find((c) => c.id === project?.clientId)

  async function markCleared(id: string) {
    setBusyId(id)
    try {
      await repo.transactions.update(id, { status: 'cleared' })
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      await repo.transactions.remove(id)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card">
      <div className="card__title">
        <h2>Payment history</h2>
      </div>

      {rows.length === 0 ? (
        <EmptyState>No payments logged for this project yet.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Against</th>
                <th>Method</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((transaction) => {
                const against = invoices.find((i) => i.id === transaction.invoiceId)
                const remaining = project
                  ? projectTotals(project, invoices, transactions).balanceCents
                  : 0

                return (
                  <tr key={transaction.id}>
                    <td>{formatDateForHumans(transaction.paidOn)}</td>
                    <td className="muted">{against?.label ?? '—'}</td>
                    <td className="muted">
                      {PAYMENT_METHOD_LABELS[transaction.method]}
                      {transaction.reference && ` · ${transaction.reference}`}
                    </td>
                    <td className="num">{formatCents(transaction.amountCents)}</td>
                    <td>
                      <span
                        className={`pill pill--${transaction.status === 'cleared' ? 'fully_paid' : 'neutral'}`}
                      >
                        {transaction.status === 'cleared' ? 'Cleared' : 'Pending'}
                      </span>
                    </td>
                    <td className="num">
                      <div className="inline-list" style={{ justifyContent: 'flex-end' }}>
                        {client && isUsableWhatsAppNumber(client.whatsapp) && project && (
                          <WhatsAppButton
                            small
                            label="Receipt"
                            href={waLink(
                              client.whatsapp,
                              receiptMessage(
                                client,
                                project,
                                transaction,
                                remaining,
                              ),
                            )}
                          />
                        )}
                        {transaction.status === 'pending' && (
                          <button
                            className="btn--sm"
                            disabled={busyId === transaction.id}
                            onClick={() => markCleared(transaction.id)}
                          >
                            Mark cleared
                          </button>
                        )}
                        <button
                          className="btn--sm btn--ghost"
                          disabled={busyId === transaction.id}
                          onClick={() => remove(transaction.id)}
                          aria-label="Delete payment"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function LogPaymentModal({
  invoice,
  onClose,
}: {
  invoice: Invoice
  onClose: () => void
}) {
  const ownerId = useOwnerId()
  const { transactions, refresh } = useWorkspace()

  const outstanding = invoiceTotals(invoice, transactions).balanceCents

  // Pre-fill with what is still owed — the common case is paying it off.
  const [amount, setAmount] = useState(
    centsToInputValue(Math.max(outstanding, 0)),
  )
  const [paidOn, setPaidOn] = useState(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [cleared, setCleared] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountCents = parseAmountToCents(amount)
  const overpaying = amountCents !== null && amountCents > outstanding

  async function save() {
    if (amountCents === null || amountCents === 0) {
      setError('Enter the amount received.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      await repo.transactions.create(ownerId, {
        invoiceId: invoice.id,
        projectId: invoice.projectId,
        clientId: invoice.clientId,
        amountCents,
        paidOn,
        method,
        status: cleared ? 'cleared' : 'pending',
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
      await refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not log payment.')
      setBusy(false)
    }
  }

  return (
    <Modal title={`Log payment — ${invoice.label}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Outstanding on this invoice: <strong>{formatCents(Math.max(outstanding, 0))}</strong>
      </p>

      <div className="field-row">
        <Field label="Amount received">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoFocus
          />
        </Field>

        <Field label="Date received">
          <input
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Method">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((key) => (
              <option key={key} value={key}>
                {PAYMENT_METHOD_LABELS[key]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Reference (optional)" hint="Bank ref, or a note about the screenshot.">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
      </div>

      <label className="inline-list" style={{ fontSize: '0.875rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={cleared}
          style={{ width: 'auto' }}
          onChange={(e) => setCleared(e.target.checked)}
        />
        Money has landed in my account
      </label>
      <p className="field__hint" style={{ marginTop: '0.35rem' }}>
        Uncheck for a cheque or transfer you have been told about but not yet
        received. It still reduces the client&apos;s balance, but is left out of
        your payout until cleared.
      </p>

      {overpaying && (
        <div className="banner banner--warn" style={{ marginTop: '0.75rem' }}>
          That is more than the invoice asks for. The extra will show as a
          credit.
        </div>
      )}

      {error && (
        <div className="banner banner--error" role="alert" style={{ marginTop: '0.75rem' }}>
          {error}
        </div>
      )}

      <div className="modal__actions">
        <button onClick={onClose}>Cancel</button>
        <button className="btn--primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Log payment'}
        </button>
      </div>
    </Modal>
  )
}

function AddInvoiceModal({
  project,
  existingCount,
  uninvoicedCents,
  onClose,
}: {
  project: { id: string; clientId: string; billingType: string }
  existingCount: number
  uninvoicedCents: number
  onClose: () => void
}) {
  const ownerId = useOwnerId()
  const { refresh } = useWorkspace()

  const isMilestone = project.billingType === 'milestone'

  const [label, setLabel] = useState(
    isMilestone ? `Milestone ${existingCount + 1}` : '',
  )
  const [dueDate, setDueDate] = useState(addDays(todayIso(), 7))
  const [rows, setRows] = useState<LineRow[]>([blankRow()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lines = rows.map(toLineItem).filter((line) => line !== null)
  const totalCents = lineItemsTotalCents(lines)
  const exceedsAgreed = totalCents > uninvoicedCents && uninvoicedCents > 0

  function updateRow(index: number, patch: Partial<LineRow>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }

  async function save() {
    if (!label.trim()) {
      setError('Give the invoice a label.')
      return
    }
    if (lines.length === 0) {
      setError('Add at least one line with a description.')
      return
    }
    if (totalCents === 0) {
      setError('The invoice total is zero — check the rates.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      await repo.invoices.create(ownerId, {
        projectId: project.id,
        clientId: project.clientId,
        label: label.trim(),
        // Derived from the lines, so every balance calculation downstream
        // keeps working without knowing this invoice was itemised.
        amountDueCents: totalCents,
        dueDate,
        lineItems: lines,
      })
      await refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save invoice.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Add invoice" onClose={onClose}>
      <div className="field-row">
        <Field
          label="Label"
          hint={isMilestone ? 'What phase does this cover?' : undefined}
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Brand guidelines phase"
            autoFocus
          />
        </Field>

        <Field label="Date">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
      </div>

      <div className="lines">
        <div className="lines__head">
          <span>Qty</span>
          <span>Description</span>
          <span>Rate</span>
          <span className="num">Amount</span>
          <span />
        </div>

        {rows.map((row, index) => {
          const line = toLineItem(row)
          return (
            <div className="lines__row" key={index}>
              <input
                aria-label="Quantity"
                value={row.quantity}
                inputMode="decimal"
                onChange={(e) => updateRow(index, { quantity: e.target.value })}
              />
              <input
                aria-label="Description"
                value={row.description}
                placeholder="FB Post"
                onChange={(e) =>
                  updateRow(index, { description: e.target.value })
                }
              />
              <input
                aria-label="Rate"
                value={row.rate}
                inputMode="decimal"
                placeholder="1000.00"
                onChange={(e) => updateRow(index, { rate: e.target.value })}
              />
              <span className="num lines__amount">
                {line ? formatCents(lineItemTotalCents(line)) : '—'}
              </span>
              <button
                className="btn--ghost btn--sm"
                aria-label="Remove line"
                disabled={rows.length === 1}
                onClick={() =>
                  setRows((current) => current.filter((_, i) => i !== index))
                }
              >
                ✕
              </button>
            </div>
          )
        })}

        <div className="lines__foot">
          <button
            className="btn--sm"
            onClick={() => setRows((current) => [...current, blankRow()])}
          >
            + Add line
          </button>
          <strong className="num">Total {formatCents(totalCents)}</strong>
        </div>
      </div>

      {uninvoicedCents > 0 && (
        <p className="field__hint">
          {formatCents(uninvoicedCents)} of the agreed total is still
          uninvoiced.
        </p>
      )}

      {exceedsAgreed && (
        <div className="banner banner--warn">
          This takes the invoiced total above the agreed amount for the project.
        </div>
      )}

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      )}

      <div className="modal__actions">
        <button onClick={onClose}>Cancel</button>
        <button className="btn--primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Add invoice'}
        </button>
      </div>
    </Modal>
  )
}

/** A line as it exists mid-edit: raw strings, before parsing. */
interface LineRow {
  quantity: string
  description: string
  rate: string
}

function blankRow(): LineRow {
  return { quantity: '1', description: '', rate: '' }
}

/**
 * Parse an edited row, or null if it is not yet a usable line. A blank rate is
 * treated as zero so an included-at-no-charge line can be typed naturally.
 */
function toLineItem(row: LineRow): InvoiceLineItem | null {
  if (!row.description.trim()) return null

  const quantity = Number(row.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null

  const unitPriceCents =
    row.rate.trim() === '' ? 0 : parseAmountToCents(row.rate)
  if (unitPriceCents === null) return null

  return { description: row.description.trim(), quantity, unitPriceCents }
}
