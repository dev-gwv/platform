import { useEffect, useState } from 'react'
import { ASSISTANT_PROVIDERS } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Select, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { useAssistantSettings, useSaveAssistantSettings, useTestAssistant } from './api'

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
  const test = useTestAssistant()

  const [on, setOn] = useState(false)
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [callUrl, setCallUrl] = useState('')
  const [limit, setLimit] = useState('')
  const [prompt, setPrompt] = useState('')
  const [fbUrl, setFbUrl] = useState('')
  const [fbModel, setFbModel] = useState('')
  const [perMinute, setPerMinute] = useState('')
  const [perDay, setPerDay] = useState('')

  const d = q.data
  const num = (v: number | null) => (v === null ? '' : String(v))
  useEffect(() => {
    if (!d) return
    setOn(d.assistant_enabled)
    setModel(d.assistant_model ?? '')
    setBaseUrl(d.assistant_base_url ?? '')
    setCallUrl(d.support_call_url ?? '')
    setLimit(num(d.assistant_daily_limit))
    setPrompt(d.assistant_prompt ?? '')
    setFbUrl(d.assistant_fallback_base_url ?? '')
    setFbModel(d.assistant_fallback_model ?? '')
    setPerMinute(num(d.assistant_minute_tokens))
    setPerDay(num(d.assistant_day_tokens))
  }, [d])

  if (q.isLoading) return <SkeletonList rows={3} />
  if (!d) return null

  const changed =
    on !== d.assistant_enabled ||
    model !== (d.assistant_model ?? '') ||
    baseUrl !== (d.assistant_base_url ?? '') ||
    callUrl !== (d.support_call_url ?? '') ||
    limit !== num(d.assistant_daily_limit) ||
    prompt !== (d.assistant_prompt ?? '') ||
    fbUrl !== (d.assistant_fallback_base_url ?? '') ||
    fbModel !== (d.assistant_fallback_model ?? '') ||
    perMinute !== num(d.assistant_minute_tokens) ||
    perDay !== num(d.assistant_day_tokens)

  const n = Number(limit)
  const limitOk = limit.trim() === '' || (Number.isInteger(n) && n >= 1 && n <= 1000)
  /** Empty means the server's default; anything typed must be a whole number in range. */
  const whole = (v: string, lo: number, hi: number) =>
    v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi)
  const minuteOk = whole(perMinute, 1_000, 10_000_000)
  const dayOk = whole(perDay, 1_000, 1_000_000_000)
  const budgetOk = minuteOk && dayOk
  const asNumber = (v: string) => (v.trim() === '' ? null : Number(v))

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

        {/* ── the second vendor ─────────────────────────────── */}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <p className="text-sm font-semibold">If that one will not answer</p>
          {d.fallback_ready ? (
            <StatusBadge tone="success">Second key is set</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">No second key</StatusBadge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Tried when the first provider refuses or cannot be reached — a spent free-tier quota, a dead key, an outage.
          It needs its own key on the server (AI_FALLBACK_API_KEY): the same key at a second address survives none of those.
        </p>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Second provider
          <Select
            value={ASSISTANT_PROVIDERS.find((p) => p.baseUrl === fbUrl)?.key ?? (fbUrl ? 'custom' : '')}
            onChange={(e) => {
              const pick = ASSISTANT_PROVIDERS.find((p) => p.key === e.target.value)
              if (!pick) {
                setFbUrl('')
                setFbModel('')
                return
              }
              setFbUrl(pick.baseUrl)
              if (!fbModel.trim()) setFbModel(pick.suggest)
            }}
          >
            <option value="">None — one provider only</option>
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

        {fbUrl.trim() !== '' && (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Second address
              <Input
                className={cn(fbUrl.trim() && 'border-success/60')}
                value={fbUrl}
                onChange={(e) => setFbUrl(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Second model
              <Input className={filled(fbModel)} placeholder="openai/gpt-oss-20b" value={fbModel} onChange={(e) => setFbModel(e.target.value)} />
            </label>
            {!d.fallback_ready && (
              <p className="text-xs text-warning">
                AI_FALLBACK_API_KEY is not set on the server, so this address would refuse every question it is handed.
              </p>
            )}
          </>
        )}

        {/* ── what the provider allows ──────────────────────── */}
        <div className="mt-2 border-t border-border pt-3">
          <p className="text-sm font-semibold">What the provider allows</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Shared by every studio at once, so this is counted in tokens and not in questions. Groq’s free tier for
            gpt-oss-120b is 8,000 a minute and 200,000 a day, which is the default when these are empty.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Tokens a minute
            <Input
              className={cn('max-w-36', perMinute.trim() ? (minuteOk ? 'border-success/60' : 'border-destructive') : '')}
              inputMode="numeric"
              placeholder="8000"
              value={perMinute}
              onChange={(e) => setPerMinute(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Tokens a day
            <Input
              className={cn('max-w-36', perDay.trim() ? (dayOk ? 'border-success/60' : 'border-destructive') : '')}
              inputMode="numeric"
              placeholder="200000"
              value={perDay}
              onChange={(e) => setPerDay(e.target.value)}
            />
          </label>
        </div>
        {!budgetOk && (
          <p className="text-xs text-destructive">
            Whole numbers: 1,000–10,000,000 a minute and 1,000–1,000,000,000 a day, or empty for the free tier’s.
          </p>
        )}

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

        <div className="flex flex-wrap items-center gap-2">
        <Button
          className="self-start"
          disabled={!changed || !limitOk || !budgetOk || save.isPending}
          onClick={() =>
            save.mutate({
              assistant_enabled: on,
              assistant_prompt: prompt.trim() || null,
              assistant_model: model.trim() || null,
              assistant_base_url: baseUrl.trim() || null,
              support_call_url: callUrl.trim() || null,
              assistant_daily_limit: limit.trim() === '' ? null : n,
              assistant_fallback_base_url: fbUrl.trim() || null,
              assistant_fallback_model: fbModel.trim() || null,
              assistant_minute_tokens: asNumber(perMinute),
              assistant_day_tokens: asNumber(perDay),
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save assistant'}
        </Button>

        {/* "A key is set" is not "the key works". This asks one real question. */}
        <Button
          variant="outline"
          className="self-start"
          disabled={test.isPending || changed}
          onClick={() => test.mutate()}
          title={changed ? 'Save first, then test' : undefined}
        >
          {test.isPending ? 'Asking…' : 'Test the connection'}
        </Button>
        </div>

        {test.data && (
          <div
            className={cn(
              'rounded-md border p-3 text-sm',
              test.data.status === 'answered'
                ? 'border-success/40 bg-success/5'
                : test.data.status === 'escalated'
                  ? 'border-warning/40 bg-warning/5'
                  : 'border-destructive/40 bg-destructive/5',
            )}
          >
            <p className="font-medium">
              {test.data.status === 'answered'
                ? `It works. ${test.data.model ?? 'The model'} answered in ${(test.data.ms / 1000).toFixed(1)}s.`
                : test.data.status === 'escalated'
                  ? 'It answered, but offered a call rather than the steps — check the prompt.'
                  : test.data.status === 'skipped'
                    ? 'Nothing was sent: the server has no AI_API_KEY.'
                    : 'It could not answer.'}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{test.data.answer}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {test.data.prompt_tokens?.toLocaleString('en-IN') ?? '—'} tokens of help content went with the question.
              {test.data.error ? ` · ${test.data.error}` : ''}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
