import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { useOwnerId } from '../auth/AuthProvider'
import { EMPTY_WORKSPACE, loadWorkspace, type Workspace } from './repository'

interface WorkspaceState extends Workspace {
  loading: boolean
  error: string | null
  /** Re-read everything after a write. Cheap at this data volume. */
  refresh: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const ownerId = useOwnerId()
  const [data, setData] = useState<Workspace>(EMPTY_WORKSPACE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setData(await loadWorkspace(ownerId))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load your data from Firestore.',
      )
    } finally {
      setLoading(false)
    }
  }, [ownerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<WorkspaceState>(
    () => ({ ...data, loading, error, refresh }),
    [data, loading, error, refresh],
  )

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>
}

export function useWorkspace(): WorkspaceState {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used inside a WorkspaceProvider')
  }
  return context
}
