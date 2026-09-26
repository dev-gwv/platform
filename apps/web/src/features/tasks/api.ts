import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  applyBundleRequest,
  companyTaskPriority,
  createBundleRequest,
  updateBundleRequest,
  createTaskPriorityRequest,
  updateTaskPriorityRequest,
  createTaskRequest,
  taskActivityItem,
  taskBundle,
  taskListItem,
  taskSubmissionItem,
  updateTaskRequest,
  z,
  type BlockTaskRequest,
  type ReviewTaskRequest,
  type SubmitTaskRequest,
  type ApplyBundleRequest,
  type CreateBundleRequest,
  type UpdateBundleRequest,
  type CreateTaskPriorityRequest,
  type UpdateTaskPriorityRequest,
  type SetBoardOrderRequest,
  type TaskStatus,
  type UpdateTaskRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const tasksList = taskListItem.array()
const bundlesList = taskBundle.array()
const created = z.object({ id: z.string() })
const countOnly = z.object({ created: z.number() })
const anySchema = z.any()

export function useTasks() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: () => callApi('/tasks', { responseSchema: tasksList }),
    enabled: !!session && access.hasModule('tasks'),
    staleTime: 15_000,
  })
}

/** Single task for the detail dialog (server GET /tasks/:id). */
export function useTask(id: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'detail', id],
    queryFn: () => callApi(`/tasks/${id}`, { responseSchema: taskListItem }),
    enabled: !!session && !!id,
    staleTime: 15_000,
  })
}

/** Subtasks of one task — client-side slice of the list (parent_task_id). */
export function useSubtasks(parentId: string | null) {
  const { data } = useTasks()
  return useMemo(
    () => (data ?? []).filter((t) => t.parent_task_id === parentId),
    [data, parentId],
  )
}

/** One project's own tasks — its detail page's Tasks tab. */
export function useProjectTasks(projectId: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'project', projectId],
    queryFn: () => callApi(`/tasks?project_id=${projectId}`, { responseSchema: tasksList }),
    enabled: !!session && access.hasModule('tasks') && !!projectId,
    staleTime: 15_000,
  })
}

/** The production board's own view — same rows, lane order applied. */
export function useBoard() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'board'],
    queryFn: () => callApi('/tasks/board', { responseSchema: tasksList }),
    enabled: !!session && access.hasModule('tasks'),
    staleTime: 15_000,
  })
}

const laneColorRow = z.object({ lane_key: z.string(), color: z.string() })

/** Per-lane colour for the board, keyed by lane. */
export function useLaneColors() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'board', 'lanes'],
    queryFn: async () => {
      const rows = await callApi('/tasks/board/lanes', { responseSchema: laneColorRow.array() })
      return Object.fromEntries(rows.map((r) => [r.lane_key, r.color])) as Record<string, string>
    },
    enabled: !!session && access.hasModule('tasks'),
    staleTime: 60_000,
  })
}

export function useSetLaneColor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lane, color }: { lane: string; color: string }) =>
      callApi(`/tasks/board/lanes/${lane}`, { method: 'PUT', body: { color }, responseSchema: z.any() }),
    // Optimistic: a colour that lags a round trip feels broken.
    onMutate: async ({ lane, color }) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'board', 'lanes'] })
      const prev = qc.getQueryData<Record<string, string>>(['tasks', 'board', 'lanes'])
      qc.setQueryData(['tasks', 'board', 'lanes'], { ...(prev ?? {}), [lane]: color })
      return { prev }
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks', 'board', 'lanes'], ctx.prev)
      toast.error(e.message)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['tasks', 'board', 'lanes'] }),
  })
}

export function useSetBoardOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SetBoardOrderRequest) =>
      callApi('/tasks/board/order', { method: 'POST', body: input, responseSchema: anySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', 'board'] }),
  })
}

/**
 * The board's status setter: same endpoint as useSetTaskStatus, but silent.
 * Dragging a card between lanes IS the feedback; a toast per drop is noise.
 */
export function useUpdateTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      callApi(`/tasks/${id}/status`, { method: 'PATCH', body: { status }, responseSchema: anySchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useBundles() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'bundles'],
    queryFn: () => callApi('/tasks/bundles', { responseSchema: bundlesList }),
    enabled: !!session && access.hasModule('tasks'),
    staleTime: 60_000,
  })
}

function useTaskMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  success?: string | ((out: TOutput) => string),
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      const msg = typeof success === 'function' ? success(out) : success
      if (msg) toast.success(msg)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateTask() {
  return useTaskMutation(
    (input: z.input<typeof createTaskRequest>) =>
      callApi('/tasks', {
        method: 'POST',
        body: createTaskRequest.parse(input),
        responseSchema: created,
      }),
    'Task created',
  )
}

export function useSetTaskStatus() {
  return useTaskMutation(
    ({ id, status }: { id: string; status: TaskStatus }) =>
      callApi(`/tasks/${id}/status`, {
        method: 'PATCH',
        body: { status },
        responseSchema: anySchema,
      }),
    'Task updated',
  )
}

export function useUpdateTask() {
  return useTaskMutation(
    ({ id, patch }: { id: string; patch: UpdateTaskRequest }) =>
      callApi(`/tasks/${id}`, {
        method: 'PATCH',
        body: updateTaskRequest.parse(patch),
        responseSchema: anySchema,
      }),
    'Task updated',
  )
}

export function useDeleteTask() {
  return useTaskMutation((id: string) => callApi(`/tasks/${id}`, { method: 'DELETE', responseSchema: anySchema }), 'Task deleted')
}

export function useCreateBundle() {
  return useTaskMutation(
    (input: CreateBundleRequest) =>
      callApi('/tasks/bundles', {
        method: 'POST',
        body: createBundleRequest.parse(input),
        responseSchema: created,
      }),
    'Bundle saved',
  )
}

export function useUpdateBundle() {
  return useTaskMutation(
    ({ id, input }: { id: string; input: UpdateBundleRequest }) =>
      callApi(`/tasks/bundles/${id}`, {
        method: 'PATCH',
        body: updateBundleRequest.parse(input),
        responseSchema: anySchema,
      }),
    'Bundle updated',
  )
}

export function useDeleteBundle() {
  return useTaskMutation(
    (id: string) => callApi(`/tasks/bundles/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Bundle deleted',
  )
}

export function useApplyBundle() {
  return useTaskMutation(
    ({ id, input }: { id: string; input: ApplyBundleRequest }) =>
      callApi(`/tasks/bundles/${id}/apply`, {
        method: 'POST',
        body: applyBundleRequest.parse(input),
        responseSchema: countOnly,
      }),
    (out) => `${out.created} ${out.created === 1 ? 'task' : 'tasks'} created`,
  )
}

/** The signed-in person's own tasks — RLS hands employees only what they are on. */
/** My own tasks on one project -- My Work's project page. */
export function useMyProjectTasks(projectId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'my', 'project', projectId],
    queryFn: () => callApi(`/tasks/my?project_id=${projectId}`, { responseSchema: tasksList }),
    enabled: !!session && !!projectId,
    staleTime: 15_000,
  })
}

export function useMyTasks() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'my'],
    queryFn: () => callApi('/tasks/my', { responseSchema: tasksList }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

/** Move one of your own tasks; the RPC refuses a task you are not assigned to. A voice-note link can ride along. */
export function useUpdateMyTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, voice_note_url }: { id: string; status: TaskStatus; voice_note_url?: string | null }) =>
      callApi(`/tasks/my/${id}/status`, {
        method: 'PATCH',
        body: voice_note_url !== undefined ? { status, voice_note_url } : { status },
        responseSchema: anySchema,
      }),
    onSuccess: () => {
      toast.success('Task updated')
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** The studio's own priority labels — "Rush", "Whenever" — layered over low/medium/high/urgent. */
export function useTaskPriorities() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['tasks', 'priorities'],
    queryFn: () => callApi('/tasks/priorities', { responseSchema: companyTaskPriority.array() }),
    enabled: !!session && access.hasModule('tasks'),
    staleTime: 5 * 60_000,
  })
}

export function useCreateTaskPriority() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTaskPriorityRequest) =>
      callApi('/tasks/priorities', { method: 'POST', body: createTaskPriorityRequest.parse(input), responseSchema: companyTaskPriority }),
    onSuccess: () => {
      toast.success('Priority added')
      void qc.invalidateQueries({ queryKey: ['tasks', 'priorities'] })
    },
  })
}

export function useUpdateTaskPriority() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskPriorityRequest }) =>
      callApi(`/tasks/priorities/${id}`, { method: 'PATCH', body: updateTaskPriorityRequest.parse(patch), responseSchema: companyTaskPriority }),
    onSuccess: () => {
      toast.success('Priority updated')
      void qc.invalidateQueries({ queryKey: ['tasks', 'priorities'] })
    },
  })
}

export function useDeleteTaskPriority() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/tasks/priorities/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Priority deleted')
      void qc.invalidateQueries({ queryKey: ['tasks', 'priorities'] })
    },
  })
}

// ── The delegation loop (0192) ─────────────────────────────────

/** What happened to a task, newest first. */
export function useTaskActivity(id: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'activity', id],
    queryFn: () => callApi(`/tasks/${id}/activity`, { responseSchema: taskActivityItem.array() }),
    enabled: !!session && !!id,
    staleTime: 15_000,
  })
}

/** Work handed in against a task, newest first. */
export function useTaskSubmissions(id: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'submissions', id],
    queryFn: () => callApi(`/tasks/${id}/submissions`, { responseSchema: taskSubmissionItem.array() }),
    enabled: !!session && !!id,
    staleTime: 15_000,
  })
}

export function useSubmitTask() {
  return useTaskMutation(
    ({ id, input }: { id: string; input: SubmitTaskRequest }) =>
      callApi(`/tasks/${id}/submit`, { method: 'POST', body: input, responseSchema: created }),
    'Work submitted for review',
  )
}

export function useBlockTask() {
  return useTaskMutation(
    ({ id, input }: { id: string; input: BlockTaskRequest }) =>
      callApi(`/tasks/${id}/block`, { method: 'POST', body: input, responseSchema: anySchema }),
    'Marked as blocked',
  )
}

export function useReviewTask() {
  return useTaskMutation(
    ({ id, input }: { id: string; input: ReviewTaskRequest }) =>
      callApi(`/tasks/${id}/review`, { method: 'POST', body: input, responseSchema: anySchema }),
    (_out) => 'Review saved',
  )
}

/**
 * Move a task from a card or the drawer. The person on it goes through the
 * assignee endpoint (which refuses Done — that is a review); someone who
 * manages tasks uses the manager one.
 */
export function useMoveTask() {
  return useTaskMutation(
    ({ id, status, manage }: { id: string; status: TaskStatus; manage: boolean }) =>
      callApi(manage ? `/tasks/${id}/status` : `/tasks/my/${id}/status`, {
        method: 'PATCH',
        body: { status },
        responseSchema: anySchema,
      }),
    'Task updated',
  )
}

/**
 * How many of my open tasks are late: the sidebar badge. Polled once a
 * minute like the notification bell (react-query pauses it behind the tab).
 */
export function useMyOverdueCount(today: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'my', 'overdue', today],
    queryFn: () =>
      callApi(`/tasks/my/overdue?today=${today}`, { responseSchema: z.object({ count: z.number().int() }) }),
    enabled: !!session,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
