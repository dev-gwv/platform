import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { teamDirectoryRoutes } from './routes-directory'
import { payToRoutes } from './routes-pay-to'
import { jobRoleRoutes } from './routes-roles'
import { memberRoutes } from './routes-members'
import { invitationRoutes } from './routes-invitations'
import { monthlySalaryRoutes } from './routes-salaries'

/** Team directory. /members backs pickers; /directory is the full staff list. */
export const teamRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Profile gaps, the member picker, the directory, one member's overview
  // and their documents.
  .route('/', teamDirectoryRoutes)

  // Where a member's pay goes, read and set by whoever pays them.
  .route('/', payToRoutes)

  // Job roles: the library, the studio's own, and a member's set.
  .route('/', jobRoleRoutes)

  // Members: add, change, remove, reset password, sign-in details.
  .route('/', memberRoutes)

  // Invitations.
  .route('/', invitationRoutes)

  // The monthly salaries ledger.
  .route('/', monthlySalaryRoutes)
