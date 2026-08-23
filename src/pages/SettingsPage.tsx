import { useState } from 'react'

import { useOwnerId } from '../auth/AuthProvider'
import { useWorkspace } from '../data/WorkspaceProvider'
import * as repo from '../data/repository'
import { Field } from '../components/ui'
import type { BusinessProfile } from '../types/domain'

/**
 * Your own details, printed at the top and bottom of every invoice.
 * Stored as one document per owner, so there is nothing to migrate if this
 * grows a logo or a bank-details block later.
 */
export function SettingsPage() {
  const ownerId = useOwnerId()
  const { profile, loading, refresh } = useWorkspace()

  const [draft, setDraft] = useState<BusinessProfile>(
    profile ?? { businessName: '' },
  )
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof BusinessProfile>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  async function save() {
    if (!draft.businessName.trim()) {
      setError('Your business needs a name — it is the invoice heading.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      // Strip empty optional fields rather than storing empty strings, so the
      // invoice can test for presence with a plain truthiness check.
      const cleaned = Object.fromEntries(
        Object.entries(draft).filter(([, value]) => String(value).trim() !== ''),
      ) as unknown as BusinessProfile

      await repo.businessProfile.save(ownerId, cleaned)
      await refresh()
      setSaved(true)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save your details.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="page"><div className="empty">Loading…</div></div>
  }

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>Business details</h1>
          <p>These are printed on every invoice.</p>
        </div>
      </div>

      <section className="card">
        <Field label="Business name" hint="The heading across the top of the invoice.">
          <input
            value={draft.businessName}
            onChange={(e) => set('businessName', e.target.value)}
            placeholder="Creative Paradise"
          />
        </Field>

        <Field label="Tagline">
          <input
            value={draft.tagline ?? ''}
            onChange={(e) => set('tagline', e.target.value)}
            placeholder="We will create your idea."
          />
        </Field>

        <div className="field-row">
          <Field label="Email">
            <input
              type="email"
              value={draft.email ?? ''}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>

          <Field label="Mobile">
            <input
              value={draft.mobile ?? ''}
              onChange={(e) => set('mobile', e.target.value)}
              inputMode="tel"
            />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Website">
            <input
              value={draft.website ?? ''}
              onChange={(e) => set('website', e.target.value)}
              placeholder="www.example.lk"
            />
          </Field>

          <Field label="Facebook">
            <input
              value={draft.facebook ?? ''}
              onChange={(e) => set('facebook', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Closing line" hint="Printed under the totals.">
          <input
            value={draft.thankYouNote ?? ''}
            onChange={(e) => set('thankYouNote', e.target.value)}
            placeholder="Thank you for joining with us"
          />
        </Field>

        <Field label="Footer note" hint="The blurb in the band at the bottom.">
          <textarea
            rows={3}
            value={draft.footerNote ?? ''}
            onChange={(e) => set('footerNote', e.target.value)}
          />
        </Field>

        {error && (
          <div className="banner banner--error" role="alert">
            {error}
          </div>
        )}

        <div className="modal__actions">
          {saved && <span className="muted">Saved.</span>}
          <button className="btn--primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </section>
    </div>
  )
}
