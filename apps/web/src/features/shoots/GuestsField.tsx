import { Input, Label } from '@/shared/ui/input'

/** One number box: how many people are expected at the function. */
export function GuestsField({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (v: string) => void
  id: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Guests</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
        placeholder="e.g. 400"
        className="max-w-[10rem]"
      />
    </div>
  )
}
