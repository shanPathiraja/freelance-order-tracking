import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useWorkspace } from '../data/WorkspaceProvider'
import {
  dashboardSummary,
  daysBetween,
  deliveryBucket,
  dueBucket,
  invoiceTotals,
  orderTotals,
  todayIso,
  type DueBucket,
} from '../lib/calc'
import { formatCents } from '../lib/money'
import {
  formatDateForHumans,
  isUsableWhatsAppNumber,
  reminderMessage,
  waLink,
} from '../lib/whatsapp'
import {
  DeliveryPill,
  DuePill,
  EmptyState,
  Money,
  OrderStatusPill,
  Stat,
  StatusPill,
  WhatsAppButton,
} from '../components/ui'
import { BILLING_TYPE_LABELS, isOpenOrder } from '../types/domain'

export function DashboardPage() {
  const { clients, orders, invoices, transactions, loading, error } =
    useWorkspace()
  const today = todayIso()

  const summary = useMemo(
    () => dashboardSummary(orders, invoices, transactions, today),
    [orders, invoices, transactions, today],
  )

  /**
   * The manual replacement for the document's automated reminder triggers:
   * everything overdue or due within three days, worst first, each with a
   * ready-to-send WhatsApp nudge.
   */
  const needsChasing = useMemo(() => {
    const activeIds = new Set(
      orders.filter((o) => isOpenOrder(o.status)).map((o) => o.id),
    )

    return invoices
      .filter((invoice) => activeIds.has(invoice.orderId))
      .map((invoice) => ({
        invoice,
        bucket: dueBucket(invoice, transactions, today),
        totals: invoiceTotals(invoice, transactions),
        order: orders.find((p) => p.id === invoice.orderId),
        client: clients.find((c) => c.id === invoice.clientId),
      }))
      .filter(
        (row): row is typeof row & { bucket: Extract<DueBucket, 'overdue' | 'due_soon'> } =>
          row.bucket === 'overdue' || row.bucket === 'due_soon',
      )
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate))
  }, [clients, orders, invoices, transactions, today])

  /**
   * Orders promised soon or already late. Delivery deadlines are tracked
   * separately from payment dates — a paid order can still be overdue to
   * deliver, and vice versa.
   */
  const deliveries = useMemo(
    () =>
      orders
        .map((order) => ({
          order,
          bucket: deliveryBucket(order, today),
          client: clients.find((c) => c.id === order.clientId),
        }))
        .filter((row) => row.bucket === 'overdue' || row.bucket === 'due_soon')
        .sort((a, b) => (a.order.dueDate ?? '').localeCompare(b.order.dueDate ?? '')),
    [clients, orders, today],
  )

  /** Section 3 of the scenario document: one row per active order. */
  const ledger = useMemo(
    () =>
      orders
        .filter((o) => isOpenOrder(o.status))
        .map((order) => ({
          order,
          client: clients.find((c) => c.id === order.clientId),
          totals: orderTotals(order, invoices, transactions),
        }))
        .sort((a, b) => b.totals.balanceCents - a.totals.balanceCents),
    [clients, orders, invoices, transactions],
  )

  if (loading) return <div className="page"><div className="empty">Loading…</div></div>

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>Dashboard</h1>
          <p>{formatDateForHumans(today)}</p>
        </div>
      </div>

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      )}

      <div className="stat-grid">
        <Stat
          label="Outstanding"
          value={formatCents(summary.outstandingCents)}
          hint={`across ${summary.activeOrders} active order${summary.activeOrders === 1 ? '' : 's'}`}
          alert={summary.outstandingCents > 0}
        />
        <Stat
          label="Collected"
          value={formatCents(summary.collectedCents)}
          hint={
            summary.pendingClearanceCents > 0
              ? `${formatCents(summary.pendingClearanceCents)} not yet cleared`
              : 'all cleared'
          }
        />
        <Stat
          label="Your payout"
          value={formatCents(summary.payoutCents)}
          hint="cleared money, after commission"
        />
        <Stat
          label="Book of work"
          value={formatCents(summary.totalAgreedCents)}
          hint="agreed across active orders"
        />
      </div>

      <section className="card">
        <div className="card__title">
          <h2>Deliveries due</h2>
          {summary.overdueDeliveries > 0 && (
            <span className="pill pill--overdue">
              {summary.overdueDeliveries} late
            </span>
          )}
          {summary.deliveriesDueSoon > 0 && (
            <span className="pill pill--due_soon">
              {summary.deliveriesDueSoon} this week
            </span>
          )}
        </div>

        {deliveries.length === 0 ? (
          <EmptyState>Nothing due for delivery in the next week.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Order</th>
                  <th>Due</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deliveries.map(({ order, bucket, client }) => {
                  const days = daysBetween(today, order.dueDate ?? today)
                  return (
                    <tr key={order.id}>
                      <td>{client?.name ?? '—'}</td>
                      <td>
                        <Link className="row-link" to={`/orders/${order.id}`}>
                          {order.title}
                        </Link>
                      </td>
                      <td>
                        <div className="inline-list">
                          <span>{formatDateForHumans(order.dueDate ?? '')}</span>
                          <DeliveryPill bucket={bucket} />
                        </div>
                      </td>
                      <td className="muted">{describeDays(days)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__title">
          <h2>Needs chasing</h2>
          {summary.overdueInvoices > 0 && (
            <span className="pill pill--overdue">
              {summary.overdueInvoices} overdue
            </span>
          )}
          {summary.dueSoonInvoices > 0 && (
            <span className="pill pill--due_soon">
              {summary.dueSoonInvoices} due soon
            </span>
          )}
        </div>

        {needsChasing.length === 0 ? (
          <EmptyState>Nothing overdue or due in the next three days.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Invoice</th>
                  <th>Due</th>
                  <th className="num">Outstanding</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {needsChasing.map(({ invoice, bucket, totals, order, client }) => (
                  <tr key={invoice.id}>
                    <td>
                      {order ? (
                        <Link className="row-link" to={`/orders/${order.id}`}>
                          {client?.name ?? 'Unknown client'}
                        </Link>
                      ) : (
                        client?.name
                      )}
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {order?.title}
                      </div>
                    </td>
                    <td>{invoice.label}</td>
                    <td>
                      <div className="inline-list">
                        <span>{formatDateForHumans(invoice.dueDate)}</span>
                        <DuePill bucket={bucket} />
                      </div>
                    </td>
                    <td className="num">
                      <Money cents={totals.balanceCents} />
                    </td>
                    <td className="num">
                      {client && isUsableWhatsAppNumber(client.whatsapp) && order && (
                        <WhatsAppButton
                          small
                          label="Remind"
                          href={waLink(
                            client.whatsapp,
                            reminderMessage(
                              client,
                              order,
                              invoice,
                              totals.balanceCents,
                              bucket === 'overdue',
                            ),
                          )}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__title">
          <h2>Active ledger</h2>
          <Link className="btn btn--sm" to="/clients">
            Manage clients
          </Link>
        </div>

        {ledger.length === 0 ? (
          <EmptyState>
            No active orders yet. Add a client, then create their first
            order.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Order</th>
                  <th>Due</th>
                  <th>Billing</th>
                  <th className="num">Agreed</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map(({ order, client, totals }) => (
                  <tr key={order.id}>
                    <td>{client?.name ?? '—'}</td>
                    <td>
                      <Link className="row-link" to={`/orders/${order.id}`}>
                        {order.title}
                      </Link>
                      <div style={{ marginTop: '0.25rem' }}>
                        <OrderStatusPill status={order.status} />
                      </div>
                    </td>
                    <td>
                      {order.dueDate ? (
                        <div className="inline-list">
                          <span>{formatDateForHumans(order.dueDate)}</span>
                          <DeliveryPill bucket={deliveryBucket(order, today)} />
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">
                      {BILLING_TYPE_LABELS[order.billingType]}
                    </td>
                    <td className="num">
                      {formatCents(totals.committedCents)}
                    </td>
                    <td className="num">{formatCents(totals.paidCents)}</td>
                    <td className="num">
                      <Money cents={totals.balanceCents} />
                    </td>
                    <td>
                      <StatusPill status={totals.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/** '3 days late', 'due today', 'in 5 days'. */
function describeDays(days: number): string {
  if (days === 0) return 'due today'
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} late`
  return `in ${days} day${days === 1 ? '' : 's'}`
}
