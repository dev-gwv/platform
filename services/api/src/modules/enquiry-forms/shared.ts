import type { TransactionSql } from 'postgres'
import type { AuthContext } from '../../context'

/**
 * Owners and managers change the enquiry form, its partners and downloads;
 * everyone else with Leads can only share the form (spec 4.7).
 */
export const canManageLeads = (a: AuthContext): boolean =>
  a.isOwner || a.role === 'super_admin' || a.role === 'admin' || a.role === 'manager' || a.role === 'platform_admin'

/** The caller's studio's main form, made on first ask (0274). */
export async function mainFormRow(sql: TransactionSql): Promise<{ id: string; slug: string | null; code: string }> {
  const [row] = await sql<{ id: string; slug: string | null; code: string }[]>`select id, slug, code from enquiry_main_form()`
  return row!
}

export const appBase = (appUrl: string | undefined): string => (appUrl ?? '').replace(/\/+$/, '')
