import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  type NavLinkRenderProps,
} from 'react-router-dom'

import { AuthProvider, useAuth } from './auth/AuthProvider'
import { WorkspaceProvider } from './data/WorkspaceProvider'
import { isFirebaseConfigured } from './lib/firebase'
import { ClientsPage } from './pages/ClientsPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { InvoicePrintPage } from './pages/InvoicePrintPage'
import { OrderPage } from './pages/OrderPage'
import { SettingsPage } from './pages/SettingsPage'
import { SetupPage } from './pages/SetupPage'

export default function App() {
  // No order configured means nothing else can work — say so plainly rather
  // than showing a login form that could never succeed.
  if (!isFirebaseConfigured) return <SetupPage />

  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </AuthProvider>
  )
}

function AuthGate() {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="centered">Loading…</div>
  }

  if (!user) return <LoginPage />

  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
  )
}

function navClass({ isActive }: NavLinkRenderProps) {
  return isActive ? 'is-active' : undefined
}

function AppShell() {
  const { user, signOutUser } = useAuth()

  return (
    <div className="shell">
      {/* Header and nav stick as one unit — a separately sticky header would
          slide over the nav and hide it on the first scroll. */}
      <div className="appbar">
        <header className="topbar">
          <div className="topbar__brand">
            Freelance Ledger
            <span>{user?.email}</span>
          </div>
          <button className="btn--sm" onClick={() => void signOutUser()}>
            Sign out
          </button>
        </header>

        <nav className="nav">
          <NavLink to="/" end className={navClass}>
            Dashboard
          </NavLink>
          <NavLink to="/clients" className={navClass}>
            Clients
          </NavLink>
          <NavLink to="/settings" className={navClass}>
            Settings
          </NavLink>
        </nav>
      </div>

      <main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/orders/:orderId" element={<OrderPage />} />
          <Route
            path="/invoices/:invoiceId/print"
            element={<InvoicePrintPage />}
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </main>
    </div>
  )
}
