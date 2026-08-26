import type { ReactNode } from 'react'

import { formatCents } from '../lib/money'
import {
  PAYMENT_STATUS_LABELS,
  type PaymentStatus,
} from '../types/domain'
import type { DeliveryBucket, DueBucket } from '../lib/calc'

export function StatusPill({ status }: { status: PaymentStatus }) {
  return (
    <span className={`pill pill--${status}`}>
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  )
}

const BUCKET_LABELS: Partial<Record<DueBucket, string>> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
}

export function DuePill({ bucket }: { bucket: DueBucket }) {
  const label = BUCKET_LABELS[bucket]
  if (!label) return null

  return <span className={`pill pill--${bucket}`}>{label}</span>
}

const DELIVERY_LABELS: Partial<Record<DeliveryBucket, string>> = {
  overdue: 'Late',
  due_soon: 'Due soon',
}

/** Delivery urgency for an order — distinct from an invoice's payment status. */
export function DeliveryPill({ bucket }: { bucket: DeliveryBucket }) {
  const label = DELIVERY_LABELS[bucket]
  if (!label) return null

  return <span className={`pill pill--${bucket}`}>{label}</span>
}

export function Stat({
  label,
  value,
  hint,
  alert = false,
}: {
  label: string
  value: string
  hint?: string
  alert?: boolean
}) {
  return (
    <div className={`stat${alert ? ' stat--alert' : ''}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  )
}

/** Amount cell that reads a negative balance as a credit rather than a minus. */
export function Money({ cents }: { cents: number }) {
  if (cents < 0) {
    return (
      <span className="credit">{formatCents(-cents)} credit</span>
    )
  }
  return <>{formatCents(cents)}</>
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? (
        <span className="field__error">{error}</span>
      ) : (
        hint && <span className="field__hint">{hint}</span>
      )}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <h2>{title}</h2>
          <button className="btn--ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Opens WhatsApp with a pre-filled message. No API, no integration. */
export function WhatsAppButton({
  href,
  label = 'WhatsApp',
  small = false,
}: {
  href: string
  label?: string
  small?: boolean
}) {
  return (
    <a
      className={`btn btn--wa${small ? ' btn--sm' : ''}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
