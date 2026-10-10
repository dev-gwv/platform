import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { crmObjectsRouter } from './objects'
import { crmActivitiesRouter } from './activities'
import { crmWorkflowsRouter } from './workflows'
import { crmQuotesRouter } from './quotes'
import { crmLeadRoutes } from './routes-leads'
import { crmBulkRoutes } from './routes-bulk'
import { crmImportRoutes } from './routes-import'
import { crmReportRoutes } from './routes-reports'
import { crmTemplateRoutes } from './routes-templates'
import { crmConvertRoutes } from './routes-convert'
import { crmCadenceRoutes } from './routes-cadences'
import { crmSettingsRoutes } from './routes-settings'
import { crmSourceRoutes } from './routes-sources'

export const crmRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('crm'))

  // Leads: list, add, change.
  .route('/', crmLeadRoutes)

  // Bulk edits with undo, permanent erasure, duplicates and merging.
  .route('/', crmBulkRoutes)

  // CSV import.
  .route('/', crmImportRoutes)

  // Reports.
  .route('/', crmReportRoutes)

  // Message templates, and sending one to a lead.
  .route('/', crmTemplateRoutes)

  // Lead -> client (and project).
  .route('/', crmConvertRoutes)

  // Cadences, and a lead's place on one.
  .route('/', crmCadenceRoutes)

  // Saved views, CRM settings and the distribution rota.
  .route('/', crmSettingsRoutes)

  // Lead sources and each source's import log.
  .route('/', crmSourceRoutes)

  // Pipelines, stages, contacts, companies, lost reasons, forecast.
  .route('/', crmObjectsRouter)
  // Activities, timeline, calls, meetings, mailbox sync, integrations.
  .route('/', crmActivitiesRouter)
  // Workflows, enrollments, scoring.
  .route('/', crmWorkflowsRouter)
  // Quotes and per-person preferences.
  .route('/', crmQuotesRouter)
