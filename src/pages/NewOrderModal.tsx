import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useOwnerId } from '../auth/AuthProvider'
import { useWorkspace } from '../data/WorkspaceProvider'
import * as repo from '../data/repository'
import { todayIso } from '../lib/calc'
import { parseAmountToCents } from '../lib/money'
import { addDays, BILLING_TYPE_HINTS, initialInvoices } from '../lib/invoicing'
import { Field, Modal } from '../components/ui'
import { BILLING_TYPE_LABELS, type BillingType } from '../types/domain'

const BILLING_TYPES = Object.keys(BILLING_TYPE_LABELS) as BillingType[]

export function NewOrderModal({
  clientId,
  onClose,
}: {
  clientId: string
  onClose: () => void
}) {
  const ownerId = useOwnerId()
  const { refresh } = useWorkspace()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [billingType, setBillingType] = useState<BillingType>('fixed_split')
  const [amount, setAmount] = useState('')
  const [commission, setCommission] = useState('0')
  const [dueDate, setDueDate] = useState(addDays(todayIso(), 14))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const agreedAmountCents = parseAmountToCents(amount)
    const commissionPercent = Number(commission)

    if (!title.trim()) {
      setError('Give the order a title.')
      return
    }
    if (agreedAmountCents === null || agreedAmountCents === 0) {
      setError('Enter the agreed amount, e.g. 400.')
      return
    }
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      setError('Commission must be between 0 and 100.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      const orderId = await repo.orders.create(ownerId, {
        clientId,
        title: title.trim(),
        billingType,
        agreedAmountCents,
        commissionRate: commissionPercent / 100,
        status: 'initial',
        // Delivery deadline, distinct from the invoice payment dates that
        // initialInvoices raises below.
        ...(dueDate ? { dueDate } : {}),
      })

      // The billing type decides which invoices exist from day one; milestone
      // orders intentionally start with none.
      const drafts = initialInvoices(
        { id: orderId, clientId, billingType, agreedAmountCents },
        todayIso(),
      )
      if (drafts.length > 0) {
        await repo.invoices.createMany(ownerId, drafts)
      }

      await refresh()
      onClose()
      navigate(`/orders/${orderId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save order.')
      setBusy(false)
    }
  }

  return (
    <Modal title="New order" onClose={onClose}>
      <Field label="Order title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Menu Design & Banner Printing"
          autoFocus
        />
      </Field>

      <Field label="Billing type" hint={BILLING_TYPE_HINTS[billingType]}>
        <select
          value={billingType}
          onChange={(e) => setBillingType(e.target.value as BillingType)}
        >
          {BILLING_TYPES.map((type) => (
            <option key={type} value={type}>
              {BILLING_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      <div className="field-row">
        <Field
          label={
            billingType === 'monthly_retainer'
              ? 'Amount per month'
              : 'Agreed amount'
          }
        >
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="400.00"
          />
        </Field>

        <Field label="Agency commission %" hint="0 if you work solo.">
          <input
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            inputMode="decimal"
          />
        </Field>
      </div>

      <Field
        label="Delivery due date"
        hint="When the work is promised. Separate from when payment is due."
      >
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
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
          {busy ? 'Creating…' : 'Create order'}
        </button>
      </div>
    </Modal>
  )
}
