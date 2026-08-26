import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'

import { auth, isFirebaseConfigured } from '../lib/firebase'

interface AuthState {
  user: User | null
  /** True until Firebase has told us whether a session exists. */
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)

  useEffect(() => {
    // Without an order to talk to there is no session to wait for.
    if (!isFirebaseConfigured) return

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password)
      },
      signOutUser: () => signOut(auth),
    }),
    [user, loading],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}

/**
 * The signed-in user's uid, for code that only runs behind the auth gate.
 * Throws rather than returning undefined so a missing ownerId can never be
 * written to Firestore.
 */
export function useOwnerId(): string {
  const { user } = useAuth()
  if (!user) throw new Error('useOwnerId requires a signed-in user')
  return user.uid
}
