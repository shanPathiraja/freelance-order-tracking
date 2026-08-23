/**
 * Firebase initialisation.
 *
 * These keys are not secrets — a web app's Firebase config ships to the
 * browser by design, and the only thing protecting the data is the security
 * rules in firestore.rules. They live in env vars so the repo isn't tied to
 * one project, not because they need hiding.
 */

import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/**
 * True once the app has a real project to talk to. The UI checks this so a
 * fresh clone shows setup instructions instead of an opaque Firebase error.
 */
export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId)

const app = initializeApp(
  isFirebaseConfigured
    ? config
    : // Placeholder values keep initializeApp from throwing at import time;
      // nothing will be called against them because the UI gates on the flag.
      { apiKey: 'not-configured', projectId: 'not-configured', appId: 'not-configured' },
)

export const auth = getAuth(app)
export const db = getFirestore(app)

/**
 * Point at the local emulator suite instead of the real project. Lets you
 * develop against throwaway data — and exercise the security rules — without
 * touching production or spending free-tier quota.
 *
 *   npm run emulators   (terminal 1)
 *   npm run dev         (terminal 2)
 */
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
