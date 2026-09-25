import { canQuickAddLookup } from '@ipc/permissions'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

/** May the signed-in person add a value to this studio list from a form? Same rule as the API. */
export function useCanAddLookup(category: string): boolean {
  const { session } = useAuth()
  const access = useAccess()
  return canQuickAddLookup(access, session?.is_owner ?? false, category)
}
