import { useState } from 'react'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { taskColumnPage, taskColumns, z, type TaskColumns, type TaskListItem, type TaskStatus } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { refreshTasks } from './refresh'
import { appendToColumn, laneOrderBody, moveTasks, reorderColumn, taskColumnPagePath, taskColumnsPath, type BoardQuery } from './board-columns'

const COLUMNS: QueryKey = ['tasks', 'columns']
const columnsKey = (b: BoardQuery): QueryKey => [...COLUMNS, b]
const anySchema = z.any()

/**
 * The board, paged (speed audit, 21 Nov): each status's first 30 cards with
 * its own total, the toolbar applied on the server. Someone who cannot see
 * the studio's tasks gets their own (the server decides).
 */
export function useTaskColumns(b: BoardQuery, enabled = true) {
  const { session } = useAuth()
  return useQuery({
    queryKey: columnsKey(b),
    queryFn: () => callApi(taskColumnsPath(b), { responseSchema: taskColumns }),
    enabled: enabled && !!session,
    staleTime: 15_000,
    // A new search or filter keeps the old cards up until its answer lands.
    placeholderData: (prev) => prev,
  })
}

/** Show more on one column: the next 30 of that status, added under the cards already there. */
export function useTaskColumnMore(b: BoardQuery) {
  const qc = useQueryClient()
  const [loading, setLoading] = useState<TaskStatus | null>(null)
  const more = async (status: TaskStatus, cursor: string) => {
    setLoading(status)
    try {
      const page = await callApi(taskColumnPagePath(b, status, cursor), { responseSchema: taskColumnPage })
      qc.setQueryData<TaskColumns>(columnsKey(b), (old) => (old ? appendToColumn(old, status, page) : old))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not load more tasks.')
    } finally {
      setLoading(null)
    }
  }
  return { more, loading }
}

type Snapshot = [QueryKey, TaskColumns | undefined][]

/** Change every cached board now; hand back what was there to put back on error. */
async function patchBoards(qc: ReturnType<typeof useQueryClient>, change: (d: TaskColumns) => TaskColumns): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: COLUMNS })
  const snap = qc.getQueriesData<TaskColumns>({ queryKey: COLUMNS })
  for (const [key, data] of snap) if (data) qc.setQueryData(key, change(data))
  return snap
}

const laneIds = (d: TaskColumns | undefined, status: TaskStatus) =>
  d?.columns.find((c) => c.status === status)?.items.map((r) => r.id) ?? []
/** The lane holds cards not loaded yet: the server places them after the ones sent. */
const laneHasMore = (d: TaskColumns | undefined, status: TaskStatus) => !!d?.columns.find((c) => c.status === status)?.next_cursor

/**
 * A card dragged, or ticked cards moved from the bulk bar. The cards land at
 * once -- both columns' cards and header counts -- and go back if the server
 * refuses. A drag also saves the hand order of the lanes it touched (the
 * cards loaded; a card further down keeps its place, and so does every card
 * a search or person filter hides). Afterwards one request
 * per list on screen refreshes what the browser cannot know.
 */
export function useBoardMoves(b: BoardQuery) {
  const qc = useQueryClient()
  const [pending, setPending] = useState(false)

  async function run(change: (d: TaskColumns) => TaskColumns, save: (after: TaskColumns | undefined) => Promise<unknown>) {
    setPending(true)
    const snap = await patchBoards(qc, change)
    try {
      await save(qc.getQueryData<TaskColumns>(columnsKey(b)))
      return true
    } catch (e) {
      for (const [key, data] of snap) qc.setQueryData(key, data)
      toast.error(e instanceof Error ? e.message : 'We could not move that.')
      return false
    } finally {
      setPending(false)
      void refreshTasks(qc)
    }
  }

  const order = (lane: TaskStatus, ids: string[], after: TaskColumns | undefined) =>
    callApi('/tasks/board/order', {
      method: 'POST',
      body: laneOrderBody(b, lane, ids, laneHasMore(after, lane)),
      responseSchema: anySchema,
    })
  const status = (id: string, to: TaskStatus) =>
    callApi(`/tasks/${id}/status`, { method: 'PATCH', body: { status: to }, responseSchema: anySchema })

  return {
    pending,
    /** A drag inside one lane: its new order. */
    reorder: (lane: TaskStatus, ids: string[]) =>
      run(
        (d) => reorderColumn(d, lane, ids),
        (after) => order(lane, ids, after),
      ),
    /** A drag across lanes: the card lands at `at` in `to`. */
    drag: (task: TaskListItem, from: TaskStatus, to: TaskStatus, at: number) =>
      run(
        (d) => moveTasks(d, [task], to, at),
        async (after) => {
          await status(task.id, to)
          await Promise.all([order(to, laneIds(after, to), after), order(from, laneIds(after, from), after)])
        },
      ),
    /** The bulk bar: every ticked card to the top of `to`. */
    bulk: (tasks: TaskListItem[], to: TaskStatus) =>
      run(
        (d) => moveTasks(d, tasks, to),
        () => Promise.all(tasks.filter((t) => t.status !== to).map((t) => status(t.id, to))),
      ),
  }
}
