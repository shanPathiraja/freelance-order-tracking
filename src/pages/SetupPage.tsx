/**
 * Shown when no Firebase config is present, so a fresh clone explains itself
 * instead of failing with an opaque SDK error.
 */
export function SetupPage() {
  return (
    <div className="centered">
      <div className="card auth-card" style={{ maxWidth: 520 }}>
        <h1>Almost there</h1>
        <p>This app needs a Firebase project before it can store anything.</p>

        <ol className="setup-steps">
          <li>
            Create a project at <code>console.firebase.google.com</code> — the
            free Spark plan is enough.
          </li>
          <li>
            Under <strong>Build → Firestore Database</strong>, create a database
            in production mode.
          </li>
          <li>
            Under <strong>Build → Authentication</strong>, enable the
            Email/Password provider and add yourself as a user.
          </li>
          <li>
            Under <strong>Project settings → General</strong>, register a web
            app and copy its config values.
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code>, paste the
            values in, and restart the dev server.
          </li>
          <li>
            Deploy the security rules: <code>firebase deploy --only firestore:rules</code>
          </li>
        </ol>
      </div>
    </div>
  )
}
