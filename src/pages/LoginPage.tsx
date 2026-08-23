import { useState, type FormEvent } from 'react'

import { useAuth } from '../auth/AuthProvider'
import { Field } from '../components/ui'

/** Maps Firebase's error codes onto something a human can act on. */
function describeAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look right.'
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check your connection.'
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled on this Firebase project yet.'
    case 'auth/configuration-not-found':
      // Firebase Authentication has never been initialised on the project.
      // Distinct from operation-not-allowed, which means Auth exists but this
      // one provider is off. Easy to hit on first setup, so name the fix.
      return 'Authentication is not set up on this Firebase project yet. Enable Email/Password in the Firebase console under Build → Authentication.'
    default:
      return 'Could not sign in. Please try again.'
  }
}

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await signIn(email, password)
    } catch (cause) {
      const code =
        cause && typeof cause === 'object' && 'code' in cause
          ? String(cause.code)
          : ''
      setError(describeAuthError(code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="centered">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1>Freelance Ledger</h1>
        <p>Sign in to your tracking workspace.</p>

        <Field label="Email">
          <input
            type="email"
            value={email}
            autoComplete="username"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {error && (
          <div className="banner banner--error" role="alert">
            {error}
          </div>
        )}

        <div className="modal__actions">
          <button type="submit" className="btn--primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        <p className="field__hint" style={{ marginTop: '0.75rem' }}>
          Accounts are created in the Firebase console under Authentication →
          Users. There is no public sign-up.
        </p>
      </form>
    </div>
  )
}
