import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  addMemberRequest,
  addMemberResponse,
  assignRolesRequest,
  createInvitationRequest,
  updateInvitationRequest,
  directoryMember,
  employeeRole,
  generateMonthlySalariesRequest,
  libraryRole,
  invitation,
  invitationLink,
  monthlySalaryList,
  updateMemberRequest,
  updateMonthlySalaryRequest,
  upsertEmployeeRoleRequest,
  z,
  type AddMemberRequest,
  type AssignRolesRequest,
  type CreateInvitationRequest,
  type GenerateMonthlySalariesRequest,
  type UpdateInvitationRequest,
  type UpdateMemberRequest,
  type UpdateMonthlySalaryRequest,
  type UpsertEmployeeRoleRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const directoryList = directoryMember.array()
const rolesList = employeeRole.array()
const libraryList = libraryRole.array()
const invitationsList = invitation.array()
const ok = z.object({ ok: z.boolean() })

/** Everything the Team page reads and writes. One key prefix: ['team']. */
export function useDirectory() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['team', 'directory'],
    queryFn: () => callApi('/team/directory', { responseSchema: directoryList }),
    enabled: !!session && access.hasModule('team_directory'),
    staleTime: 30_000,
  })
}

export interface DirectoryPageParams {
  page: number
  page_size: number
  search?: string | undefined
  status?: string | undefined
  /** Engagement: 'in_house' or 'freelancer'. */
  engagement_type?: string | undefined
  /** `app:<role>` for the access ladder, `job:<uuid>` for a studio job role. */
  role?: string | undefined
  min_salary?: string | undefined
  max_salary?: string | undefined
}

const directoryPageSchema = z.object({
  items: directoryList,
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
})

/**
 * Server-paginated directory (Lovable parity). Falls back to client-side
 * slicing when the server answers with the legacy array shape, so mixed
 * deploys never break the page.
 */
export function useDirectoryPaged(params: DirectoryPageParams) {
  const { session } = useAuth()
  const access = useAccess()
  const qs = new URLSearchParams({
    page: String(params.page),
    page_size: String(params.page_size),
  })
  if (params.search?.trim()) qs.set('search', params.search.trim())
  if (params.status) qs.set('status', params.status)
  if (params.engagement_type) qs.set('engagement_type', params.engagement_type)
  if (params.role) qs.set('role', params.role)
  if (params.min_salary?.trim()) qs.set('min_salary', params.min_salary.trim())
  if (params.max_salary?.trim()) qs.set('max_salary', params.max_salary.trim())
  const key = qs.toString()
  return useQuery({
    queryKey: ['team', 'directory', 'paged', key],
    queryFn: async () => {
      const raw: unknown = await callApi(`/team/directory?${key}`, {
        responseSchema: z.unknown(),
      })
      const paged = directoryPageSchema.safeParse(raw)
      if (paged.success) return paged.data
      const items = directoryList.parse(raw)
      const start = (params.page - 1) * params.page_size
      return {
        items: items.slice(start, start + params.page_size),
        total: items.length,
        page: params.page,
        page_size: params.page_size,
      }
    },
    enabled: !!session && access.hasModule('team_directory'),
    staleTime: 15_000,
  })
}

/** Delete with an optional reason, recorded in the audit trail. */
export function useDeleteMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string | null }) =>
      callApi(`/team/members/${userId}`, {
        method: 'DELETE',
        body: reason ? { reason } : {},
        responseSchema: ok,
      }),
    onSuccess: () => {
      toast.success('Team member removed')
      void qc.invalidateQueries({ queryKey: ['team'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** One member's stored access (profile + overrides) for ManageAccessDialog. */
export function useUserAccess(userId: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['team', 'access', userId],
    queryFn: () =>
      callApi(`/access/${userId}`, {
        responseSchema: z.object({
          profile_key: z.string().nullable(),
          overrides: z.array(z.object({ permission_key: z.string(), enabled: z.boolean() })),
        }),
      }),
    enabled: !!session?.is_owner && !!userId,
    staleTime: 30_000,
  })
}

export function useSetUserAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      profile_key,
      overrides,
    }: {
      userId: string
      profile_key: string | null
      overrides: { permission_key: string; enabled: boolean }[]
    }) =>
      callApi(`/access/${userId}`, {
        method: 'PUT',
        body: { profile_key, overrides },
        responseSchema: z.unknown(),
      }),
    onSuccess: (_d, v) => {
      toast.success('Access updated')
      void qc.invalidateQueries({ queryKey: ['team', 'access', v.userId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useEmployeeRoles() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['team', 'roles'],
    queryFn: () => callApi('/team/roles', { responseSchema: rolesList }),
    enabled: !!session && access.hasModule('team_roles'),
    staleTime: 60_000,
  })
}

/**
 * The platform's catalogue of standard photography roles.
 *
 * Read-only and the same for everyone, so it caches long: a studio picks from
 * it once when setting up and rarely again.
 */
export function useRoleLibrary() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['team', 'role-library'],
    queryFn: () => callApi('/team/role-library', { responseSchema: libraryList }),
    enabled: !!session && access.hasModule('team_roles'),
    staleTime: 30 * 60_000,
  })
}

/** Owner-only: the invitations panel is hidden outright for everyone else. */
export function useInvitations() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['team', 'invitations'],
    queryFn: () => callApi('/team/invitations', { responseSchema: invitationsList }),
    enabled: !!session?.is_owner,
    staleTime: 30_000,
  })
}

function useTeamMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  success?: string | ((out: TOutput, input: TInput) => string),
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (out, input) => {
      const msg = typeof success === 'function' ? success(out, input) : success
      if (msg) toast.success(msg)
      void qc.invalidateQueries({ queryKey: ['team'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAddMember() {
  return useTeamMutation(
    (input: AddMemberRequest) =>
      callApi('/team/members', {
        method: 'POST',
        body: addMemberRequest.parse(input),
        responseSchema: addMemberResponse,
      }),
    // Someone already on another studio's team keeps their own login: this
    // studio was added to it, and the password typed in the form was not used.
    (out, input) =>
      out.linked_existing_login
        ? `${input.name} added. They already use IPC with ${input.email}, so they sign in with their own password and switch to your studio.`
        : `${input.name} added to the team`,
  )
}

/**
 * The calls bulk add makes, without the per-call toast the single-member hooks
 * raise. Forty "X added to the team" toasts stacked over the table would bury
 * the one message that matters, so a batch reports once, at the end, and asks
 * for the team lists to refresh once rather than after every row.
 */
export function useBulkTeamCalls() {
  const qc = useQueryClient()
  return {
    addMember: (input: AddMemberRequest) =>
      callApi('/team/members', {
        method: 'POST',
        body: addMemberRequest.parse(input),
        responseSchema: addMemberResponse,
      }),
    createRole: (input: UpsertEmployeeRoleRequest) =>
      callApi('/team/roles', {
        method: 'POST',
        body: upsertEmployeeRoleRequest.parse(input),
        responseSchema: employeeRole,
      }),
    refresh: () => qc.invalidateQueries({ queryKey: ['team'] }),
  }
}

export function useUpdateMember() {
  return useTeamMutation(
    ({ userId, patch }: { userId: string; patch: UpdateMemberRequest }) =>
      callApi(`/team/members/${userId}`, {
        method: 'PATCH',
        body: updateMemberRequest.parse(patch),
        responseSchema: ok,
      }),
    'Team member updated',
  )
}

export function useRemoveMember() {
  return useTeamMutation(
    (userId: string) => callApi(`/team/members/${userId}`, { method: 'DELETE', responseSchema: ok }),
    'Team member removed',
  )
}

export function useAssignRoles() {
  return useTeamMutation(
    ({ userId, roles }: { userId: string; roles: AssignRolesRequest }) =>
      callApi(`/team/members/${userId}/roles`, {
        method: 'PATCH',
        body: assignRolesRequest.parse(roles),
        responseSchema: ok,
      }),
    'Roles updated',
  )
}

export function useSendReset() {
  return useMutation({
    mutationFn: (userId: string) =>
      callApi(`/team/members/${userId}/reset-password`, { method: 'POST', responseSchema: ok }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateRole() {
  return useTeamMutation(
    (input: UpsertEmployeeRoleRequest) =>
      callApi('/team/roles', {
        method: 'POST',
        body: upsertEmployeeRoleRequest.parse(input),
        responseSchema: employeeRole,
      }),
    'Role created',
  )
}

export function useUpdateRole() {
  return useTeamMutation(
    ({ id, patch }: { id: string; patch: UpsertEmployeeRoleRequest }) =>
      callApi(`/team/roles/${id}`, {
        method: 'PATCH',
        body: upsertEmployeeRoleRequest.parse(patch),
        responseSchema: ok,
      }),
    'Role updated',
  )
}

export function useDeleteRole() {
  return useTeamMutation(
    (id: string) => callApi(`/team/roles/${id}`, { method: 'DELETE', responseSchema: ok }),
    'Role deleted',
  )
}

export function useCreateInvitation() {
  return useTeamMutation(
    (input: CreateInvitationRequest) =>
      callApi('/team/invitations', {
        method: 'POST',
        body: createInvitationRequest.parse(input),
        responseSchema: invitationLink,
      }),
    'Invitation sent',
  )
}

export function useResendInvitation() {
  return useTeamMutation(
    (id: string) =>
      callApi(`/team/invitations/${id}/resend`, { method: 'POST', responseSchema: invitationLink }),
    'Invitation resent',
  )
}

export function useUpdateInvitation() {
  return useTeamMutation(
    ({ id, patch }: { id: string; patch: UpdateInvitationRequest }) =>
      callApi(`/team/invitations/${id}`, { method: 'PATCH', body: updateInvitationRequest.parse(patch), responseSchema: ok }),
    'Invitation updated',
  )
}

export function useRevokeInvitation() {
  return useTeamMutation(
    (id: string) => callApi(`/team/invitations/${id}`, { method: 'DELETE', responseSchema: ok }),
    'Invitation revoked',
  )
}

/** Monthly salary ledger for one period (owner/admin generate+update, manager views). */
export function useMonthlySalaries(filters: { month: number; year: number; status?: string | undefined; search?: string | undefined; user_id?: string | undefined }) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams({
    month: String(filters.month),
    year: String(filters.year),
  })
  if (filters.status && filters.status !== 'all') params.set('status', filters.status)
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  if (filters.user_id) params.set('user_id', filters.user_id)
  return useQuery({
    queryKey: ['team', 'monthly-salaries', params.toString()],
    queryFn: () => callApi(`/team/monthly-salaries?${params.toString()}`, { responseSchema: monthlySalaryList }),
    enabled: !!session && access.hasModule('team_salaries'),
    staleTime: 15_000,
  })
}

export function useGenerateMonthlySalaries() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: GenerateMonthlySalariesRequest) =>
      callApi('/team/monthly-salaries/generate', {
        method: 'POST',
        body: generateMonthlySalariesRequest.parse(input),
        responseSchema: z.object({
          created_count: z.number(),
          skipped_existing_count: z.number(),
          errors: z.array(z.string()),
        }),
      }),
    onSuccess: () => {
      toast.success('Salaries generated')
      void qc.invalidateQueries({ queryKey: ['team', 'monthly-salaries'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateMonthlySalary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateMonthlySalaryRequest }) =>
      callApi(`/team/monthly-salaries/${id}`, {
        method: 'PATCH',
        body: updateMonthlySalaryRequest.parse(patch),
        responseSchema: ok,
      }),
    onSuccess: () => {
      toast.success('Salary updated')
      void qc.invalidateQueries({ queryKey: ['team', 'monthly-salaries'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
