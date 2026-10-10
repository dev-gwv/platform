import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { projectListRoutes } from './routes-list'
import { projectTemplateRoutes } from './routes-templates'
import { productionBoardRoutes } from './routes-board'
import { projectCatalogRoutes } from './routes-catalog'
import { quotationTermsRoutes } from './routes-quotation-terms'
import { deliverableStageRoutes } from './routes-stages'
import { deliverableRoutes } from './routes-deliverables'
import { projectRoutes } from './routes-project'
import { projectMoneyRoutes } from './routes-project-money'

export const projectsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Hono matches in registration order: every literal path (/tracking,
  // /deliverable-sets, /templates, /board, /catalog, /stages, /deliverables/…)
  // is mounted before /:id, so none of them is read as a project id.

  // The project list, tracking (one row per project, and one project opened up)
  // and creating a project.
  .route('/', projectListRoutes)

  // Saved deliverable sets and project templates.
  .route('/', projectTemplateRoutes)

  // The production board, and one change to many deliverables.
  .route('/', productionBoardRoutes)

  // Shoot types and deliverable types.
  .route('/', projectCatalogRoutes)

  // The studio's quotation terms presets.
  .route('/', quotationTermsRoutes)

  // The studio's named deliverable stages.
  .route('/', deliverableStageRoutes)

  // Deliverables across projects: workload, the caller's own edits, start,
  // stage moves and notes.
  .route('/', deliverableRoutes)

  // One project: read, change, delete, and its deliverables.
  .route('/', projectRoutes)

  // One project's billing, client activity, cost sheet, payments and
  // quotation settings.
  .route('/', projectMoneyRoutes)
