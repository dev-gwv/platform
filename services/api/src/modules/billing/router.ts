import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { invoiceRoutes } from './routes-invoices'
import { billingDueRoutes } from './routes-due'
import { invoiceActionRoutes } from './routes-invoice-actions'
import { invoiceItemRoutes } from './routes-items'
import { receivedPaymentRoutes } from './routes-payments'
import { invoiceTemplateRoutes } from './routes-templates'
import { bankAccountRoutes } from './routes-bank-accounts'

export const billingRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('billing')) // finance gate: owner or a finance profile

  // GST states, and invoices: list, create, read, change, delete.
  .route('/', invoiceRoutes)

  // What is still to come in, and the Billing overview.
  .route('/', billingDueRoutes)

  // An invoice's actions: send, share, remind, cancel, record a payment.
  .route('/', invoiceActionRoutes)

  // Saved invoice items.
  .route('/', invoiceItemRoutes)

  // Payments received.
  .route('/', receivedPaymentRoutes)

  // Invoice templates and the notes snippet library.
  .route('/', invoiceTemplateRoutes)

  // Bank accounts printed on invoices.
  .route('/', bankAccountRoutes)
