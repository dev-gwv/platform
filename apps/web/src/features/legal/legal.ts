/**
 * Who runs Studio AutoPilot, for the public policy pages (Terms, Privacy, Refund,
 * Contact) a payment gateway asks every merchant to publish. This is the
 * software's own vendor -- not any studio using it -- so it lives here, in
 * one place, rather than in a studio's settings.
 *
 * Address, phone and GSTIN are optional: a page shows a line only when it is
 * filled in, so nothing untrue is ever printed.
 */
export const LEGAL = {
  appName: 'Studio AutoPilot',
  productName: 'Studio AutoPilot studio management software',
  /** The company that owns and runs the product. The old trading name is not used on any public page. */
  operatorName: 'Grateful World Ventures (OPC) Private Limited',
  supportEmail: 'support@studioautopilot.in',
  /** Registered or business address, one line per entry. */
  address: ['E-2, Nai Basti, New Silampur, Shahdara, Delhi 110053'] as string[],
  phone: '',
  gstin: '07AAJCG9243K1Z5',
  /** Corporate Identity Number, from the certificate of incorporation. */
  cin: 'U80301DL2022OPC401949',
  country: 'India',
  responseTime: 'Within 1–2 working days',
  lastUpdated: '29 September 2026',
} as const

/**
 * What a studio pays, kept in step with the plans table. Since 0214 there are
 * two audiences: the public price, and the member prices an IPC Diamond member
 * sees once verified. Prices exclude 18% GST.
 */
export const PLANS = [{ name: 'Yearly', price: '₹1,00,000', period: 'per year' }] as const

export const MEMBER_PLANS = [
  { name: 'Monthly', price: '₹1,999', period: 'per month' },
  { name: 'Yearly', price: '₹18,000', period: 'per year' },
  { name: '2-Year', price: '₹33,000', period: 'for two years' },
] as const

export const TRIAL_DAYS = 7
export const MEMBER_TRIAL_DAYS = 30

export const PLAN_SUMMARY =
  'Studio AutoPilot is ₹1,00,000 a year plus 18% GST, paid online through Razorpay, after a 7-day free trial. ' +
  'IPC Diamond members get a 30-day trial and member prices: ₹1,999 a month, ₹18,000 a year or ₹33,000 for two years, plus GST.'

export const LEGAL_LINKS = [
  { to: '/terms-and-conditions', label: 'Terms and Conditions' },
  { to: '/privacy-policy', label: 'Privacy Policy' },
  { to: '/refund-policy', label: 'Refund Policy' },
  { to: '/contact-us', label: 'Contact Us' },
  { to: '/data-deletion', label: 'Data Deletion' },
] as const
