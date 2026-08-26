# Continuous deployment

Every push runs lint, typecheck, tests and a build. A push to `main` also
deploys to Firebase Hosting and releases the Firestore security rules.

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

```
push / PR ──► check ──► (main only) build with config ──► verify ──► deploy
```

## One-time setup

Until both of the following are in place the `check` job will pass and the
`deploy` job will fail with a message naming what is missing. That is
deliberate — a silent skip would look like a successful deploy.

### 1. The Firebase service account (a secret)

The deploy needs credentials. The easiest route creates the service account
*and* stores it in GitHub for you:

```bash
npx firebase-tools init hosting:github
```

It asks for the repository (`shanPathiraja/freelance-order-tracking`), creates a
service account, and adds it as the `FIREBASE_SERVICE_ACCOUNT` secret.

**Say no when it offers to set up workflow files** — it would overwrite the one
in this repo with its own.

If you would rather do it by hand: Google Cloud console → IAM → Service
Accounts → create a key (JSON) with the **Firebase Hosting Admin** and
**Cloud Datastore Owner** roles, then paste the whole JSON file into
GitHub → Settings → Secrets and variables → Actions → **Secrets** →
`FIREBASE_SERVICE_ACCOUNT`.

### 2. The web config (repository variables)

The build needs the `VITE_FIREBASE_*` values. These are **not secrets** — a web
app's Firebase config ships to the browser by design — so they go in
**Variables**, not Secrets. They are kept out of the repo only so the code is
not tied to one project.

With the values already in your local `.env.local`, this copies them up without
printing them:

```bash
gh auth login
while IFS='=' read -r key value; do
  case "$key" in
    VITE_FIREBASE_*) gh variable set "$key" --body "$value" ;;
  esac
done < .env.local
```

Or set the six by hand under Settings → Secrets and variables → Actions →
**Variables**.

Do **not** copy `VITE_USE_EMULATORS`; the workflow forces it to `false`.

## What protects a bad deploy

- **Tests gate the deploy.** The `deploy` job `needs: check`, so a failing test
  or type error stops the release.
- **The bundle is verified before it ships.** A build with no Firebase config
  succeeds and produces an app that shows every visitor the setup screen. The
  workflow greps the built bundle for the project id and fails if it is absent,
  so that can never reach production unnoticed.
- **Deploys are serialised.** A `deploy-production` concurrency group without
  `cancel-in-progress` means two pushes queue rather than race.
- **Credentials are written from an env var** and deleted afterwards, so the
  JSON is never interpolated into a shell command where it could be mangled or
  echoed.

## Rolling back

Hosting keeps previous releases:

```bash
npx firebase-tools hosting:rollback
```

Or revert the commit and push — the pipeline redeploys the previous state.

## A caveat on the rules

The deploy releases `firestore.rules` as well as hosting, so the live rules
never drift from the repo. The trade-off is that a mistake in that file reaches
production as soon as it is merged, and these rules are the only thing
protecting the ledger. The CLI refuses to release a file that does not compile,
but it cannot tell you the logic is wrong.

If that feels too loose, drop `,firestore:rules` from the deploy step and
release rules by hand.
