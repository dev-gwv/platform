/**
 * Who runs IPC Studios, for the public policy pages (Terms, Privacy, Refund,
 * Contact) a payment gateway asks every merchant to publish. This is the
 * software's own vendor -- not any studio using it -- so it lives here, in
 * one place, rather than in a studio's settings.
 *
 * Address, phone and GSTIN are optional: a page shows a line only when it is
 * filled in, so nothing untrue is ever printed.
 */
export const LEGAL = {
  appName: 'IPC Studios',
  productName: 'IPC Studios studio management software',
  operatorName: 'IPC Studios',
  supportEmail: 'support@ipcstudios.in',
  /** Registered or business address, one line per entry. */
  address: [] as string[],
  phone: '',
  gstin: '',
  country: 'India',
  responseTime: 'Within 1–2 working days',
  lastUpdated: '25 September 2026',
} as const

/** Kept in step with the plans table (0141); prices exclude 18% GST. */
export const PLANS = [
  { name: 'Monthly', price: '₹1,999', period: 'per month' },
  { name: 'Yearly', price: '₹18,000', period: 'per year' },
  { name: '2-Year', price: '₹30,000', period: 'for two years' },
] as const

export const PLAN_SUMMARY =
  'Subscription plans are ₹1,999 per month, ₹18,000 per year, or ₹30,000 for two years, plus 18% GST, paid online through Razorpay.'

export const LEGAL_LINKS = [
  { to: '/terms-and-conditions', label: 'Terms and Conditions' },
  { to: '/privacy-policy', label: 'Privacy Policy' },
  { to: '/refund-policy', label: 'Refund Policy' },
  { to: '/contact-us', label: 'Contact Us' },
] as const
