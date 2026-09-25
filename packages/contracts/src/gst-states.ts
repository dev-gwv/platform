/**
 * GST state codes, as the first two digits of every GSTIN and as the place of
 * supply on a tax invoice. Kept here, not fetched, so a client opening an
 * invoice link (no session) still sees "Uttar Pradesh (09)", and so a GSTIN
 * typed on the invoice can pick the place of supply by itself.
 */
export const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
}

/** "Uttar Pradesh (09)" for a code, the code itself when unknown, null for none. */
export function placeOfSupplyLabel(code: string | null | undefined): string | null {
  const c = (code ?? '').trim()
  if (!c) return null
  const name = GST_STATE_NAMES[c.padStart(2, '0')]
  return name ? `${name} (${c.padStart(2, '0')})` : c
}

/** The state a GSTIN is registered in: its first two digits, when they name a state. */
export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  const c = (gstin ?? '').trim().slice(0, 2)
  return GST_STATE_NAMES[c] ? c : null
}
