import type { Context } from 'hono'
import type { TransactionSql } from 'postgres'
import type { AppEnv } from '../context'
import { withUser } from './db'
import type { StudioBrand } from './email'

interface BrandRow {
  name: string
  logo_url: string | null
  website: string | null
  studio_email: string | null
  from_name: string | null
  reply_to: string | null
  footer_line: string | null
  white_label: boolean
}

/**
 * How a studio appears on what it sends (0202). Replies go to the address
 * the studio chose, else the one on its invoices, else its owner's -- a
 * client who answers should reach the studio, never a no-reply box.
 */
export async function loadStudioBrand(
  sql: TransactionSql,
  companyId: string,
): Promise<StudioBrand & { website: string | null }> {
  const [r] = await sql<BrandRow[]>`
    select coalesce(nullif(trim(co.display_name), ''), co.name) as name,
           coalesce(nullif(co.invoice_logo_url, ''), nullif(co.avatar_url, '')) as logo_url,
           nullif(trim(co.website), '') as website,
           coalesce(nullif(co.invoice_email, ''), u.email) as studio_email,
           b.from_name, b.reply_to, b.footer_line,
           company_can(co.id, 'white_label') as white_label
      from companies co
      left join company_branding b on b.company_id = co.id
      left join users u on u.user_id = co.owner_user_id and u.company_id = co.id
     where co.id = ${companyId}`
  if (!r) throw new Error('studio not found')
  const whiteLabel = r.white_label
  return {
    name: r.name,
    logoUrl: r.logo_url,
    website: r.website,
    whiteLabel,
    fromName: whiteLabel ? r.from_name : null,
    footerLine: whiteLabel ? r.footer_line : null,
    replyTo: (whiteLabel ? r.reply_to : null) ?? r.studio_email,
  }
}

/**
 * The signed-in user's studio brand, for mail sent from a request. Null if it
 * cannot be read -- the email then goes out as before rather than not at all.
 */
export async function currentStudioBrand(c: Context<AppEnv>): Promise<StudioBrand | null> {
  try {
    return await withUser(c.env, c.get('auth').userId, (sql) => loadStudioBrand(sql, c.get('auth').companyId))
  } catch {
    return null
  }
}
