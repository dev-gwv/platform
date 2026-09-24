import { z } from 'zod'
import { GSTIN_PATTERN } from './shared/primitives'

export const companyProfile = z.object({
  name: z.string(),
  legal_name: z.string().nullable(),
  display_name: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  website: z.string().nullable(),
  invoice_gst_number: z.string().nullable(),
  /** Shown on the invoice/quote header; a plain URL, not an upload. */
  avatar_url: z.string().nullable(),
  invoice_number_prefix: z.string(),
  invoice_next_number: z.number().int(),
  quote_number_prefix: z.string(),
  quote_next_number: z.number().int(),
  /** Branding/defaults applied to every new invoice (Lovable parity). */
  invoice_address: z.string().nullable().default(null),
  invoice_phone: z.string().nullable().default(null),
  invoice_email: z.string().nullable().default(null),
  invoice_upi_id: z.string().nullable().default(null),
  /** Services Accounting Code printed on GST invoices; 998387 is photography. */
  invoice_sac_code: z.string().nullable().default(null),
  invoice_bank_details: z.string().nullable().default(null),
  invoice_default_notes: z.string().nullable().default(null),
  invoice_default_terms: z.string().nullable().default(null),
  /** Lovable parity: footer note on client documents + separate invoice logo. */
  document_footer_note: z.string().nullable().default(null),
  invoice_logo_url: z.string().nullable().default(null),
})
export type CompanyProfile = z.infer<typeof companyProfile>

export const updateCompanyRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legal_name: z.string().trim().max(160).optional(),
  display_name: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  invoice_gst_number: z.string().trim().toUpperCase().max(20)
    .refine((v) => !v || GSTIN_PATTERN.test(v), 'Invalid GSTIN format')
    .optional(),
  avatar_url: z.string().trim().max(500).optional(),
  invoice_number_prefix: z.string().trim().min(1).max(20).optional(),
  invoice_next_number: z.number().int().min(1).optional(),
  quote_number_prefix: z.string().trim().min(1).max(20).optional(),
  quote_next_number: z.number().int().min(1).optional(),
  invoice_address: z.string().trim().max(500).nullish(),
  invoice_phone: z.string().trim().max(40).nullish(),
  invoice_email: z.string().trim().max(200).nullish(),
  invoice_upi_id: z.string().trim().max(120).nullish(),
  invoice_sac_code: z.string().trim().max(12).nullish(),
  invoice_bank_details: z.string().trim().max(1000).nullish(),
  invoice_default_notes: z.string().trim().max(2000).nullish(),
  invoice_default_terms: z.string().trim().max(4000).nullish(),
  document_footer_note: z.string().trim().max(2000).nullish(),
  invoice_logo_url: z.string().trim().max(500).nullish(),
})
export type UpdateCompanyRequest = z.infer<typeof updateCompanyRequest>

/**
 * The signed-in person's own profile.
 *
 * Email is read-only: it is the login, and changing it is an identity move that
 * belongs with verification, not a settings form.
 */
export const myProfile = z.object({
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  /** A plain URL, not an upload — same as the company logo. */
  avatar_url: z.string().nullable(),
})
export type MyProfile = z.infer<typeof myProfile>

export const updateMyProfileRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  avatar_url: z.string().trim().max(500).nullable().optional(),
})
export type UpdateMyProfileRequest = z.infer<typeof updateMyProfileRequest>

/**
 * The allow-listed theme presets. The palette itself lives in the web app; this
 * is the shared key list so the server can refuse a preset that does not exist
 * instead of persisting arbitrary strings into company_theme_settings.
 */
export const themePresetKey = z.enum([
  'ipc_classic',
  'luxury_gold',
  'royal_purple',
  'blush_wedding',
  'editorial_black',
  'ocean_blue',
  'emerald_studio',
  'warm_terracotta',
  'minimal_slate',
  'premium_rose_gold',
])
export type ThemePresetKey = z.infer<typeof themePresetKey>

/**
 * Typography is chosen separately from colour: every preset ships with a
 * matching face, but a studio can keep the palette and swap the font.
 */
export const themeFontKey = z.enum([
  'inter',
  'playfair',
  'poppins',
  'lato',
  'manrope',
  'open_sans',
  'nunito',
  'merriweather',
])
export type ThemeFontKey = z.infer<typeof themeFontKey>

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

/**
 * A fully custom palette: 8 independently-picked colours instead of a named
 * preset. Every field is optional on both read and write — an unfilled one
 * just falls back to whatever the studio's current preset ships with, so
 * turning "Enable custom theme" on doesn't blank the interface.
 */
export const customThemeColorFields = [
  'primary_color',
  'secondary_color',
  'accent_color',
  'background_color',
  'surface_color',
  'text_color',
  'muted_text_color',
  'border_color',
] as const

export const companyTheme = z.object({
  // Tolerant on READ: a row written before a preset was renamed or retired must
  // still load — the UI falls back to the default rather than erroring the page.
  preset_key: z.string(),
  font_key: z.string().nullable(),
  color_scheme: z.enum(['light', 'dark', 'system']),
  custom_color: z.string().nullable().optional(),
  border_radius: z.string().nullable().optional(),
  is_custom_theme: z.boolean().default(false),
  primary_color: z.string().nullable().default(null),
  secondary_color: z.string().nullable().default(null),
  accent_color: z.string().nullable().default(null),
  background_color: z.string().nullable().default(null),
  surface_color: z.string().nullable().default(null),
  text_color: z.string().nullable().default(null),
  muted_text_color: z.string().nullable().default(null),
  border_color: z.string().nullable().default(null),
})
export type CompanyTheme = z.infer<typeof companyTheme>

export const updateThemeRequest = z.object({
  // Strict on WRITE: only a real preset gets stored.
  preset_key: themePresetKey,
  // Absent means "whatever the preset ships with", which is what the theme
  // cards send; the font picker sends an explicit key.
  font_key: themeFontKey.nullish(),
  color_scheme: z.enum(['light', 'dark', 'system']).default('light'),
  custom_color: hexColor.nullish(),
  border_radius: z.enum(['0', '0.25', '0.5', '0.75', '1']).nullish(),
  is_custom_theme: z.boolean().optional(),
  primary_color: hexColor.nullish(),
  secondary_color: hexColor.nullish(),
  accent_color: hexColor.nullish(),
  background_color: hexColor.nullish(),
  surface_color: hexColor.nullish(),
  text_color: hexColor.nullish(),
  muted_text_color: hexColor.nullish(),
  border_color: hexColor.nullish(),
})
export type UpdateThemeRequest = z.infer<typeof updateThemeRequest>

/**
 * Which outside services this deployment can actually reach.
 *
 * Every one of these has a working degraded mode, which is the problem: with
 * no credentials the app does something reasonable instead of failing, so a
 * studio can go months believing WhatsApp messages are being delivered by the
 * system when each one has been opening a wa.me tab for somebody to send by
 * hand. This is the screen that answers "is it actually on".
 *
 * Booleans only. The values themselves are secrets and never leave the server
 * — knowing that Twilio is configured is not the same as being told its token.
 */
export const integrationStatus = z.object({
  key: z.enum(['email', 'whatsapp', 'calls', 'payments', 'meta_leads', 'errors']),
  label: z.string(),
  configured: z.boolean(),
  /** What the studio gets right now, in either state. */
  detail: z.string(),
  /** The env vars an administrator has to set. Names, never values. */
  requires: z.array(z.string()),
})
export type IntegrationStatus = z.infer<typeof integrationStatus>

export const integrationStatusList = z.object({
  items: z.array(integrationStatus),
  /** production / development / … — the same value the API reports at /health. */
  environment: z.string(),
})
export type IntegrationStatusList = z.infer<typeof integrationStatusList>
