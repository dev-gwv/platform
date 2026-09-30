import { useClientProjects } from '@/features/clients/api'

/**
 * The projects to offer once a customer is picked on an invoice or a payment.
 *
 * Asked of the server for that one customer (GET /clients/:id/projects),
 * rather than filtering every project in the studio on the page: that list
 * came from an endpoint billing-only people could not read, loaded slowly,
 * and while it was missing the dropdown claimed "Not linked to a project"
 * even when it was. The blank option now says what is actually true.
 */
export function useClientProjectOptions(clientId: string, linked?: { id: string; name: string } | null) {
  const q = useClientProjects(clientId)
  const list = (q.data ?? []).map((p) => ({ id: p.id, name: p.name }))
  // A project already on the invoice shows by name even before the list
  // arrives (or if it now belongs to someone else) -- never as "not linked".
  const options = linked && !list.some((p) => p.id === linked.id) ? [linked, ...list] : list
  const blank = !clientId
    ? 'Choose the customer first'
    : q.isLoading
      ? 'Loading their projects…'
      : q.isError
        ? 'Could not load their projects'
        : list.length === 0
          ? 'No projects for this customer yet'
          : 'No project (a general invoice)'
  return { options, blank, loaded: !!clientId && q.isSuccess, count: list.length }
}
