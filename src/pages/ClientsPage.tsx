import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useOwnerId } from '../auth/AuthProvider'
import { useWorkspace } from '../data/WorkspaceProvider'
import * as repo from '../data/repository'
import { projectTotals } from '../lib/calc'
import { formatCents } from '../lib/money'
import {
  isUsableWhatsAppNumber,
  normalisePhone,
} from '../lib/whatsapp'
import { EmptyState, Field, Modal, Money, StatusPill } from '../components/ui'
import { NewProjectModal } from './NewProjectModal'
import { BILLING_TYPE_LABELS, type Client } from '../types/domain'

export function ClientsPage() {
  const { clients, projects, invoices, transactions, loading } = useWorkspace()
  // null = closed, 'new' = create, otherwise the client being edited.
  const [clientForm, setClientForm] = useState<Client | 'new' | null>(null)
  const [projectForClient, setProjectForClient] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      clients
        .map((client) => {
          const theirProjects = projects.filter((p) => p.clientId === client.id)
          const totals = theirProjects.map((p) =>
            projectTotals(p, invoices, transactions),
          )

          return {
            client,
            projects: theirProjects,
            outstandingCents: totals.reduce(
              (sum, t) => sum + Math.max(t.balanceCents, 0),
              0,
            ),
          }
        })
        .sort((a, b) => a.client.name.localeCompare(b.client.name)),
    [clients, projects, invoices, transactions],
  )

  if (loading) return <div className="page"><div className="empty">Loading…</div></div>

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>Clients</h1>
          <p>{clients.length} on the books</p>
        </div>
        <div className="actions">
          <button className="btn--primary" onClick={() => setClientForm('new')}>
            Add client
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState>
            No clients yet. Add your first one to start tracking work.
          </EmptyState>
        </div>
      ) : (
        rows.map(({ client, projects: theirProjects, outstandingCents }) => (
          <section className="card" key={client.id}>
            <div className="card__title">
              <h2>{client.name}</h2>
              {outstandingCents > 0 && (
                <span className="pill pill--partially_paid">
                  {formatCents(outstandingCents)} outstanding
                </span>
              )}
              <button className="btn--sm" onClick={() => setClientForm(client)}>
                Edit
              </button>
              <button
                className="btn--sm"
                onClick={() => setProjectForClient(client.id)}
              >
                New project
              </button>
            </div>

            <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
              WhatsApp:{' '}
              {client.whatsapp ? `+${normalisePhone(client.whatsapp)}` : 'not set'}
              {client.whatsapp && !isUsableWhatsAppNumber(client.whatsapp) && (
                <strong style={{ color: 'var(--unpaid)' }}>
                  {' '}— WhatsApp cannot open this number. Edit it to include the
                  country code.
                </strong>
              )}
              {client.email ? ` · ${client.email}` : ''}
            </p>

            {theirProjects.length === 0 ? (
              <EmptyState>No projects for this client yet.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Billing</th>
                      <th className="num">Agreed</th>
                      <th className="num">Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {theirProjects.map((project) => {
                      const totals = projectTotals(project, invoices, transactions)
                      return (
                        <tr key={project.id}>
                          <td>
                            <Link className="row-link" to={`/projects/${project.id}`}>
                              {project.title}
                            </Link>
                            {project.status !== 'active' && (
                              <span className="muted"> ({project.status})</span>
                            )}
                          </td>
                          <td className="muted">
                            {BILLING_TYPE_LABELS[project.billingType]}
                          </td>
                          <td className="num">
                            {formatCents(totals.committedCents)}
                          </td>
                          <td className="num">
                            <Money cents={totals.balanceCents} />
                          </td>
                          <td>
                            <StatusPill status={totals.status} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}

      {clientForm && (
        <ClientModal
          client={clientForm === 'new' ? null : clientForm}
          onClose={() => setClientForm(null)}
        />
      )}
      {projectForClient && (
        <NewProjectModal
          clientId={projectForClient}
          onClose={() => setProjectForClient(null)}
        />
      )}
    </div>
  )
}

/** Create a client, or edit an existing one when `client` is supplied. */
function ClientModal({
  client,
  onClose,
}: {
  client: Client | null
  onClose: () => void
}) {
  const ownerId = useOwnerId()
  const { refresh } = useWorkspace()

  const [name, setName] = useState(client?.name ?? '')
  const [whatsapp, setWhatsapp] = useState(client?.whatsapp ?? '')
  const [email, setEmail] = useState(client?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Show what the number actually resolves to, so expanding a local number to
  // international format is visible rather than a silent guess.
  const resolved = normalisePhone(whatsapp)
  const numberLooksWrong = whatsapp.trim() !== '' && !isUsableWhatsAppNumber(whatsapp)

  async function save() {
    if (!name.trim()) {
      setError('A client needs a name.')
      return
    }

    setBusy(true)
    setError(null)

    const fields = {
      name: name.trim(),
      whatsapp: resolved,
      ...(email.trim() ? { email: email.trim() } : {}),
    }

    try {
      if (client) {
        await repo.clients.update(client.id, fields)
      } else {
        await repo.clients.create(ownerId, fields)
      }
      await refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save client.')
      setBusy(false)
    }
  }

  return (
    <Modal title={client ? 'Edit client' : 'Add client'} onClose={onClose}>
      <Field label="Client name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Burger Craft"
          autoFocus
        />
      </Field>

      <Field
        label="WhatsApp number"
        hint={
          resolved
            ? `WhatsApp will open +${resolved}`
            : 'Include the country code, e.g. 94771234567 or 077 123 4567.'
        }
        error={
          numberLooksWrong
            ? `+${resolved} is not a number WhatsApp can open — check the country code and length.`
            : undefined
        }
      >
        <input
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          inputMode="tel"
          placeholder="94771234567"
        />
      </Field>

      <Field label="Email (optional)">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      )}

      <div className="modal__actions">
        <button onClick={onClose}>Cancel</button>
        <button className="btn--primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : client ? 'Save changes' : 'Add client'}
        </button>
      </div>
    </Modal>
  )
}
