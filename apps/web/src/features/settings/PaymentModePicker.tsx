import { LookupPicker } from './LookupPicker'

/** Pick a studio-defined payment mode, or add one inline without leaving the form. */
export function PaymentModePicker({ value, onChange, label = 'Mode', id }: { value: string; onChange: (v: string) => void; label?: string; id?: string }) {
  return <LookupPicker category="payment_type" value={value} onChange={onChange} label={label} id={id} emptyLabel="—" noun="mode" example="Wallet" />
}
