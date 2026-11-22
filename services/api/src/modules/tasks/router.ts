import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { routineRoutes } from './routes-routines'
import { openRoutes } from './routes-open'
import { columnRoutes } from './routes-columns'
import { priorityRoutes } from './routes-priorities'
import { myRoutes } from './routes-my'
import { boardRoutes } from './routes-board'
import { taskRoutes } from './routes-tasks'
import { delegationRoutes } from './routes-delegation'
import { bundleRoutes } from './routes-bundles'
import { detailRoutes } from './routes-detail'

export { readDoneBefore, readDoneSince, readLimit, selectTasks, type TaskFilter } from './task-query'
export { ownTaskPatch } from './shared'

/**
 * /tasks: the middleware, then each route group in order. Literal paths
 * (/routines, /open, /columns, /priorities, /my, /board, /bundles) are mounted
 * before anything '/:id'-shaped would read them as an id; the single task
 * (GET /:id) is last.
 */
export const tasksRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  // Daily tasks (0305): before every '/:id'-shaped route.
  .route('/', routineRoutes)
  // Open tasks a page at a time (GET /tasks/open), before '/:id' too.
  .route('/', openRoutes)
  // The board's columns a page at a time (GET /tasks/columns), before '/:id'.
  .route('/', columnRoutes)
  // The custom priority catalogue.
  .route('/', priorityRoutes)
  // A person's own tasks (any active member).
  .route('/', myRoutes)
  // The board's hand order and lane colours.
  .route('/', boardRoutes)
  // The studio's tasks: list, add, change, delete.
  .route('/', taskRoutes)
  // The delegation loop (0192).
  .route('/', delegationRoutes)
  // Task bundles.
  .route('/', bundleRoutes)
  // One task, last.
  .route('/', detailRoutes)
