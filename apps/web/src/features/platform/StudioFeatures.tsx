import type { EntitlementKey } from '@ipc/contracts'
import { Switch } from '@/shared/ui/switch'
import { useSetStudioFeature, useStudioFeatures } from '@/features/crm-sequences/api'

const FEATURES: { key: EntitlementKey; label: string; description: string }[] = [
  { key: 'sequences_auto', label: 'Automatic follow-ups', description: 'Sequence emails send by themselves' },
  { key: 'whatsapp_api', label: 'Own WhatsApp number', description: 'Connect their WhatsApp Business number' },
  { key: 'white_label', label: 'White label', description: 'No Studio AutoPilot on anything a client sees' },
]

/** The higher-tier switches for one studio (0202). */
export function StudioFeatures({ studioId }: { studioId: string }) {
  const q = useStudioFeatures(studioId)
  const set = useSetStudioFeature(studioId)
  const on = new Set(q.data?.keys ?? [])
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Higher plan features</p>
      {FEATURES.map((f) => (
        <Switch
          key={f.key}
          label={f.label}
          description={f.description}
          checked={on.has(f.key)}
          disabled={q.isPending || set.isPending}
          onChange={(enabled) => set.mutate({ key: f.key, enabled })}
        />
      ))}
    </div>
  )
}
