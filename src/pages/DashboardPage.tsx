import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useWorkspace } from '../data/WorkspaceProvider'
import {
  dashboardSummary,
  dueBucket,
  invoiceTotals,
  projectTotals,
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
  DuePill,
  EmptyState,
  Money,
  Stat,
  StatusPill,
  WhatsAppButton,
} from '../components/ui'
import { BILLING_TYPE_LABELS } from '../types/domain'

export function DashboardPage() {
  const { clients, projects, invoices, transactions, loading, error } =
    useWorkspace()
  const today = todayIso()

  const summary = useMemo(
    () => dashboardSummary(projects, invoices, transactions, today),
    [projects, invoices, transactions, today],
  )

  /**
   * The manual replacement for the document's automated reminder triggers:
   * everything overdue or due within three days, worst first, each with a
   * ready-to-send WhatsApp nudge.
   */
  const needsChasing = useMemo(() => {
    const activeIds = new Set(
      projects.filter((p) => p.status === 'active').map((p) => p.id),
    )

    return invoices
      .filter((invoice) => activeIds.has(invoice.projectId))
      .map((invoice) => ({
        invoice,
        bucket: dueBucket(invoice, transactions, today),
        totals: invoiceTotals(invoice, transactions),
        project: projects.find((p) => p.id === invoice.projectId),
        client: clients.find((c) => c.id === invoice.clientId),
      }))
      .filter(
        (row): row is typeof row & { bucket: Extract<DueBucket, 'overdue' | 'due_soon'> } =>
          row.bucket === 'overdue' || row.bucket === 'due_soon',
      )
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate))
  }, [clients, projects, invoices, transactions, today])

  /** Section 3 of the scenario document: one row per active project. */
  const ledger = useMemo(
    () =>
      projects
        .filter((p) => p.status === 'active')
        .map((project) => ({
          project,
          client: clients.find((c) => c.id === project.clientId),
          totals: projectTotals(project, invoices, transactions),
        }))
        .sort((a, b) => b.totals.balanceCents - a.totals.balanceCents),
    [clients, projects, invoices, transactions],
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
          hint={`across ${summary.activeProjects} active project${summary.activeProjects === 1 ? '' : 's'}`}
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
          hint="agreed across active projects"
        />
      </div>

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
                {needsChasing.map(({ invoice, bucket, totals, project, client }) => (
                  <tr key={invoice.id}>
                    <td>
                      {project ? (
                        <Link className="row-link" to={`/projects/${project.id}`}>
                          {client?.name ?? 'Unknown client'}
                        </Link>
                      ) : (
                        client?.name
                      )}
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {project?.title}
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
                      {client && isUsableWhatsAppNumber(client.whatsapp) && project && (
                        <WhatsAppButton
                          small
                          label="Remind"
                          href={waLink(
                            client.whatsapp,
                            reminderMessage(
                              client,
                              project,
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
            No active projects yet. Add a client, then create their first
            project.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Project</th>
                  <th>Billing</th>
                  <th className="num">Agreed</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map(({ project, client, totals }) => (
                  <tr key={project.id}>
                    <td>{client?.name ?? '—'}</td>
                    <td>
                      <Link className="row-link" to={`/projects/${project.id}`}>
                        {project.title}
                      </Link>
                    </td>
                    <td className="muted">
                      {BILLING_TYPE_LABELS[project.billingType]}
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
