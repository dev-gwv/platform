import { useEffect, useState } from 'react'
import { ASSISTANT_PROVIDERS } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Select, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { useAssistantSettings, useSaveAssistantSettings } from './api'

/**
 * The assistant's settings, on the Help console (0247).
 *
 * It lives here and not on its own settings page for two reasons: the
 * assistant answers from the help content this page already edits, so the two
 * belong together; and the settings rail's More group is full at its four, which
 * is the cap the owner asked for after sixteen tabs across the top.
 *
 * The API key is not here and cannot be. It is a server env var, so a leaked
 * platform login cannot read it back out of a form.
 */

const filled = (v: string) => (v.trim() ? 'border-success/60' : 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20')

export function AssistantSettingsCard() {
  const q = useAssistantSettings()
  const save = useSaveAssistantSettings()

  const [on, setOn] = useState(false)
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [callUrl, setCallUrl] = useState('')
  const [limit, setLimit] = useState('')
  const [prompt, setPrompt] = useState('')

  const d = q.data
  useEffect(() => {
    if (!d) return
    setOn(d.assistant_enabled)
    setModel(d.assistant_model ?? '')
    setBaseUrl(d.assistant_base_url ?? '')
    setCallUrl(d.support_call_url ?? '')
    setLimit(d.assistant_daily_limit === null ? '' : String(d.assistant_daily_limit))
    setPrompt(d.assistant_prompt ?? '')
  }, [d])

  if (q.isLoading) return <SkeletonList rows={3} />
  if (!d) return null

  const changed =
    on !== d.assistant_enabled ||
    model !== (d.assistant_model ?? '') ||
    baseUrl !== (d.assistant_base_url ?? '') ||
    callUrl !== (d.support_call_url ?? '') ||
    limit !== (d.assistant_daily_limit === null ? '' : String(d.assistant_daily_limit)) ||
    prompt !== (d.assistant_prompt ?? '')

  const n = Number(limit)
  const limitOk = limit.trim() === '' || (Number.isInteger(n) && n >= 1 && n <= 1000)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">Ask-for-help assistant</p>
          {/* Said plainly, because "on" without a key answers nothing. */}
          {d.ready ? (
            <StatusBadge tone="success">Key is set on the server</StatusBadge>
          ) : (
            <StatusBadge tone="warning">No API key on the server</StatusBadge>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4" />
          Show the assistant in every studio’s header
        </label>
        {on && !d.ready && (
          <p className="text-xs text-warning">
            Nothing will be drawn until AI_API_KEY is set on the server, so studios see no button either way.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm font-medium">
          Provider
          <Select
            value={ASSISTANT_PROVIDERS.find((p) => p.baseUrl === baseUrl)?.key ?? (baseUrl ? 'custom' : '')}
            onChange={(e) => {
              const pick = ASSISTANT_PROVIDERS.find((p) => p.key === e.target.value)
              if (!pick) return
              setBaseUrl(pick.baseUrl)
              // Only suggest a model into an empty box: never overwrite one
              // somebody has chosen on purpose.
              if (!model.trim()) setModel(pick.suggest)
            }}
          >
            <option value="">Server default (Groq)</option>
            {ASSISTANT_PROVIDERS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom" disabled>
              Custom (type the address below)
            </option>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Address
          <Input
            className={cn(baseUrl.trim() && 'border-success/60')}
            placeholder="Leave empty for Groq"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Model
          <Input
            className={cn(model.trim() && 'border-success/60')}
            placeholder="Leave empty for the server default"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Where “Book a call” goes
          <Input className={filled(callUrl)} placeholder="https://cal.com/…" value={callUrl} onChange={(e) => setCallUrl(e.target.value)} />
        </label>
        {!callUrl.trim() && (
          <p className="text-xs text-muted-foreground">
            Empty falls back to the onboarding call link on the server. With neither, the assistant asks studios to write in.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm font-medium">
          Questions one studio may ask a day
          <Input
            className={cn('max-w-32', limit.trim() ? (limitOk ? 'border-success/60' : 'border-destructive') : '')}
            inputMode="numeric"
            placeholder="50"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        {!limitOk && <p className="text-xs text-destructive">A whole number between 1 and 1000, or empty for 50.</p>}

        <label className="flex flex-col gap-1 text-sm font-medium">
          What the assistant is told
          <Textarea
            rows={8}
            maxLength={8000}
            placeholder="Leave empty to use the instructions built into the server."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={cn('font-mono text-xs', prompt.trim() && 'border-success/60')}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          The help content is added to this automatically — do not paste it in. {prompt.length}/8000.
        </p>

        <Button
          className="self-start"
          disabled={!changed || !limitOk || save.isPending}
          onClick={() =>
            save.mutate({
              assistant_enabled: on,
              assistant_prompt: prompt.trim() || null,
              assistant_model: model.trim() || null,
              assistant_base_url: baseUrl.trim() || null,
              support_call_url: callUrl.trim() || null,
              assistant_daily_limit: limit.trim() === '' ? null : n,
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save assistant'}
        </Button>
      </CardContent>
    </Card>
  )
}
