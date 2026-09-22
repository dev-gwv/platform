import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles, Type, Palette, Ruler } from 'lucide-react'
import { toast } from 'sonner'
import { companyTheme, type CompanyTheme, type ThemeFontKey } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import {
  DEFAULT_PRESET_KEY,
  EMPTY_CUSTOM_COLORS,
  THEME_PRESETS,
  foregroundForHex,
  presetFor,
  type CustomThemeColors,
  type ThemePreset,
} from '@/shared/theme/presets'
import { FONT_OPTIONS, FONT_KEYS, fontOr, fontStack, loadFont } from '@/shared/theme/fonts'
import { Button } from '@/shared/ui/button'
import { TiltCard } from '@/shared/ui/tilt-card'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'

import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'

const RADIUS_OPTIONS = [
  { value: '0', label: 'None' },
  { value: '0.25', label: 'Small' },
  { value: '0.5', label: 'Default' },
  { value: '0.75', label: 'Large' },
  { value: '1', label: 'Full' },
]

const COLOR_FIELDS: Array<{ key: keyof CustomThemeColors; label: string; hint: string }> = [
  { key: 'primary', label: 'Primary', hint: 'Main buttons and links' },
  { key: 'secondary', label: 'Secondary', hint: 'Highlights and nav hovers' },
  { key: 'accent', label: 'Accent', hint: 'Quiet fills and hover states' },
  { key: 'background', label: 'Background', hint: 'The page itself' },
  { key: 'surface', label: 'Surface / Card', hint: 'Cards, panels, dialogs' },
  { key: 'text', label: 'Text', hint: 'Body copy' },
  { key: 'muted_text', label: 'Muted text', hint: 'Secondary, less important copy' },
  { key: 'border', label: 'Border', hint: 'Dividers and input outlines' },
]

const CUSTOM_COLUMN_BY_FIELD: Record<keyof CustomThemeColors, keyof CompanyTheme> = {
  primary: 'primary_color',
  secondary: 'secondary_color',
  accent: 'accent_color',
  background: 'background_color',
  surface: 'surface_color',
  text: 'text_color',
  muted_text: 'muted_text_color',
  border: 'border_color',
}

function colorsFromTheme(data: CompanyTheme): CustomThemeColors {
  const out = { ...EMPTY_CUSTOM_COLORS }
  for (const field of COLOR_FIELDS) {
    const value = data[CUSTOM_COLUMN_BY_FIELD[field.key]]
    out[field.key] = typeof value === 'string' ? value : null
  }
  return out
}

const PANGRAM = 'The quick brown fox jumps over the lazy dog.'

export function AppearancePage() {
  return (
    <AuthedPage module="settings">
      <Appearance />
    </AuthedPage>
  )
}

function Appearance() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const { applyTheme, applyCustom, scheme } = useTheme()
  const isOwner = session?.is_owner ?? false

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: () => callApi('/settings/theme', { responseSchema: companyTheme }),
  })

  const save = useMutation({
    mutationFn: (body: Partial<Omit<CompanyTheme, 'font_key'>> & { preset_key: string; font_key?: string | null }) =>
      callApi('/settings/theme', {
        method: 'PATCH',
        body: { ...body, color_scheme: data?.color_scheme ?? 'light' },
        responseSchema: companyTheme,
      }),
    onSuccess: (saved) => {
      applyTheme(saved.preset_key, saved.font_key)
      applyCustom(
        saved.is_custom_theme
          ? { enabled: true, colors: colorsFromTheme(saved), radius: saved.border_radius ?? null }
          : null,
      )
      setPreview(null)
      toast.success(saved.is_custom_theme ? 'Custom theme saved' : `${presetFor(saved.preset_key).label} applied`)
      void qc.invalidateQueries({ queryKey: ['settings', 'theme'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /** An unsaved look being tried on. Null means "showing what's saved". */
  const [preview, setPreview] = useState<{ preset: string; font: string | null } | null>(null)
  const [fontFor, setFontFor] = useState<ThemePreset | null>(null)

  const savedPreset = data ? presetFor(data.preset_key).key : DEFAULT_PRESET_KEY
  const savedFont = data?.font_key ?? null
  const isCustomOn = data?.is_custom_theme ?? false

  /** The 8 fields being edited — seeded from the server once, then locally owned. */
  const [colorDraft, setColorDraft] = useState<CustomThemeColors>(EMPTY_CUSTOM_COLORS)
  const [radiusDraft, setRadiusDraft] = useState('0.5')
  const [customSeeded, setCustomSeeded] = useState(false)

  useEffect(() => {
    if (!data || customSeeded) return
    setColorDraft(colorsFromTheme(data))
    setRadiusDraft(data.border_radius ?? '0.5')
    setCustomSeeded(true)
  }, [data, customSeeded])

  // Every sample renders in its own face, so the gallery loads them all up
  // front — a card whose sample is still in the fallback stack is telling the
  // studio something untrue about what they're picking.
  useEffect(() => {
    for (const key of FONT_KEYS) loadFont(FONT_OPTIONS[key])
  }, [])

  // Paint whatever is saved when the page opens, and again whenever a preview
  // is dropped.
  useEffect(() => {
    if (!data || preview) return
    applyTheme(data.preset_key, data.font_key)
    applyCustom(
      data.is_custom_theme
        ? { enabled: true, colors: colorsFromTheme(data), radius: data.border_radius ?? null }
        : null,
    )
  }, [data, preview, applyTheme, applyCustom])

  function startPreview(preset: ThemePreset, font: string | null = null) {
    setPreview({ preset: preset.key, font })
    applyTheme(preset.key, font)
    // A custom palette overrides the preset's tokens, so previewing one while
    // custom is on would change nothing on screen. Lift the overlay for the
    // duration of the preview; cancelling puts it back.
    if (isCustomOn) applyCustom(null)
  }

  function cancelPreview() {
    setPreview(null)
    applyTheme(savedPreset, savedFont)
    applyCustom(
      data?.is_custom_theme
        ? { enabled: true, colors: colorsFromTheme(data), radius: data.border_radius ?? null }
        : null,
    )
  }

  function toggleCustomTheme(next: boolean) {
    save.mutate({
      preset_key: savedPreset,
      font_key: savedFont,
      is_custom_theme: next,
      ...Object.fromEntries(
        COLOR_FIELDS.map((f) => [CUSTOM_COLUMN_BY_FIELD[f.key], colorDraft[f.key]]),
      ),
      border_radius: radiusDraft,
    })
  }

  function saveCustomColors() {
    save.mutate({
      preset_key: savedPreset,
      font_key: savedFont,
      is_custom_theme: true,
      ...Object.fromEntries(
        COLOR_FIELDS.map((f) => [CUSTOM_COLUMN_BY_FIELD[f.key], colorDraft[f.key]]),
      ),
      border_radius: radiusDraft,
    })
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="Theme & Branding" description="How your studio's dashboard looks." />
        <SettingsTabs />
        <SkeletonCards count={3} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Theme & Branding"
        description="Pick the palette and typeface your whole studio sees."
      />
      <SettingsTabs />

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          Each theme includes a matching font. You can apply the theme directly, or use{' '}
          <span className="font-medium text-foreground">Customize Font</span> to change typography
          before saving.
          {!isOwner && ' Only the studio owner can change this.'}
        </p>
      </div>

      {preview && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="flex-1 text-sm">
            Previewing <span className="font-medium">{presetFor(preview.preset).label}</span>
            {preview.font && ` with ${fontOr(preview.font, 'inter').family}`}. Nothing is saved yet.
          </p>
          <Button variant="outline" onClick={cancelPreview}>
            Cancel
          </Button>
          <Button
            disabled={!isOwner || save.isPending}
            onClick={() =>
              save.mutate({ preset_key: preview.preset, font_key: preview.font, is_custom_theme: false })
            }
          >
            {save.isPending ? 'Saving…' : 'Save this theme'}
          </Button>
        </div>
      )}

      <Card className="mt-6">
        <CardContent className="p-4 sm:p-4">
          <Switch
            checked={isCustomOn}
            onChange={toggleCustomTheme}
            disabled={!isOwner || save.isPending}
            label="Enable custom theme"
            description={
              isCustomOn
                ? 'Your studio is using the custom palette below instead of a preset.'
                : 'When off, your workspace uses the preset picked below.'
            }
          />
        </CardContent>
      </Card>

      {isCustomOn && (
        <CustomizePanel
          colors={colorDraft}
          radius={radiusDraft}
          onColorsChange={setColorDraft}
          onRadiusChange={setRadiusDraft}
          onSave={saveCustomColors}
          canEdit={isOwner}
          busy={save.isPending}
        />
      )}

      {/* The gallery stays visible with a custom theme on. Hiding it took away
          Preview and Apply entirely, and with them the only route back to a
          preset — the toggle above was the sole way out, which reads as the
          buttons being broken. Applying a preset turns the custom theme off,
          which is what the server does with a preset-only PATCH anyway. */}
      {isCustomOn && (
        <p className="mt-6 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          Your custom palette is active, so these presets are not currently in use. Applying one
          switches the custom theme off.
        </p>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.values(THEME_PRESETS).map((p) => (
            <ThemeCard
              key={p.key}
              preset={p}
              scheme={scheme}
              applied={!isCustomOn && p.key === savedPreset}
              appliedFont={p.key === savedPreset ? savedFont : null}
              canEdit={isOwner}
              busy={save.isPending}
              previewing={preview?.preset === p.key}
              onPreview={() => startPreview(p)}
              onApply={() => save.mutate({ preset_key: p.key, font_key: null, is_custom_theme: false })}
              onCustomizeFont={() => setFontFor(p)}
            />
          ))}
      </div>

      {fontFor && (
        <FontDialog
          preset={fontFor}
          current={fontFor.key === savedPreset ? savedFont : null}
          canEdit={isOwner}
          busy={save.isPending}
          onClose={() => setFontFor(null)}
          onPreview={(font) => startPreview(fontFor, font)}
          onSave={(font) =>
            save.mutate(
              { preset_key: fontFor.key, font_key: font },
              { onSuccess: () => setFontFor(null) },
            )
          }
        />
      )}
    </>
  )
}

function ThemeCard({
  preset,
  scheme,
  applied,
  appliedFont,
  canEdit,
  busy,
  previewing,
  onPreview,
  onApply,
  onCustomizeFont,
}: {
  preset: ThemePreset
  scheme: 'light' | 'dark'
  applied: boolean
  appliedFont: string | null
  canEdit: boolean
  busy: boolean
  previewing: boolean
  onPreview: () => void
  onApply: () => void
  onCustomizeFont: () => void
}) {
  // The card shows the face this theme would actually give you: its own,
  // unless this is the applied theme and the studio has overridden it.
  const font = fontOr(appliedFont, preset.font)
  const tokens = preset[scheme]

  return (
    // A theme swatch is a showcase object, not something you read a row out
    // of, so it is one of the few places a tilt belongs.
    <TiltCard className="flex">
      <Card
        className={cn(
          'flex flex-1 flex-col',
          applied && 'border-primary ring-1 ring-primary/30',
        )}
      >
      <CardContent className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold tracking-tight">{preset.label}</h3>
          {applied && (
            <StatusBadge tone="info" className="gap-1">
              <Check className="size-3" /> Active
            </StatusBadge>
          )}
          {previewing && !applied && <StatusBadge tone="warning">Previewing</StatusBadge>}
        </div>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{preset.description}</p>

        <Swatches tokens={tokens} />

        <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Font
            </span>
            <span className="truncate text-xs text-muted-foreground">{font.hint}</span>
          </div>
          <p className="mt-1 text-lg font-semibold" style={{ fontFamily: fontStack(font) }}>
            {font.family}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground" style={{ fontFamily: fontStack(font) }}>
            {PANGRAM}
          </p>
          <button
            type="button"
            onClick={onCustomizeFont}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <Type className="size-3.5" /> Customize Font →
          </button>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
          <Button variant="outline" onClick={onPreview}>
            Preview
          </Button>
          <Button onClick={onApply} disabled={!canEdit || applied || busy}>
            {applied ? 'Applied' : 'Apply Theme'}
          </Button>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Font can be changed anytime from Customize → Typography.
        </p>
      </CardContent>
      </Card>
    </TiltCard>
  )
}

/**
 * The palette, drawn from the tokens the theme actually writes — so a swatch
 * can never promise a colour the interface won't use.
 */
function Swatches({ tokens }: { tokens: Record<string, string> }) {
  const chips: Array<[string, string]> = [
    ['Accent', tokens['--primary']!],
    ['Brand', tokens['--brand']!],
    ['Tint', tokens['--accent']!],
    ['On accent', tokens['--primary-foreground']!],
    ['Ink', tokens['--accent-foreground']!],
  ]
  return (
    <div className="mt-3 flex gap-1.5">
      {chips.map(([label, value]) => (
        <span
          key={label}
          title={`${label} — ${value}`}
          className="h-7 flex-1 rounded-full border border-border"
          style={{ backgroundColor: value }}
        />
      ))}
    </div>
  )
}

/**
 * The 8-field colour editor plus corner radius, with a live preview that only
 * reads inline CSS variables scoped to itself — so a half-typed hex never
 * repaints the whole settings page while you're still picking it.
 */
function CustomizePanel({
  colors,
  radius,
  onColorsChange,
  onRadiusChange,
  onSave,
  canEdit,
  busy,
}: {
  colors: CustomThemeColors
  radius: string
  onColorsChange: (next: CustomThemeColors) => void
  onRadiusChange: (next: string) => void
  onSave: () => void
  canEdit: boolean
  busy: boolean
}) {
  const preview: Record<string, string> = {
    '--preview-primary': colors.primary || 'var(--primary)',
    '--preview-primary-foreground': colors.primary ? foregroundForHex(colors.primary) : 'var(--primary-foreground)',
    '--preview-background': colors.background || 'var(--background)',
    '--preview-surface': colors.surface || 'var(--card)',
    '--preview-text': colors.text || 'var(--foreground)',
    '--preview-muted-text': colors.muted_text || 'var(--muted-foreground)',
    '--preview-border': colors.border || 'var(--border)',
    '--preview-radius': `${radius}rem`,
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:p-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Palette className="h-4 w-4" /> Colours
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Fine-tune your colours if you already know your brand palette. Leave a field blank to keep
              the default theme's value.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {COLOR_FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label>{f.label}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={colors[f.key] ?? '#ffffff'}
                    onChange={(e) => onColorsChange({ ...colors, [f.key]: e.target.value })}
                    disabled={!canEdit}
                    className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border disabled:cursor-not-allowed"
                  />
                  <Input
                    value={colors[f.key] ?? ''}
                    onChange={(e) => onColorsChange({ ...colors, [f.key]: e.target.value || null })}
                    placeholder={f.hint}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Ruler className="h-4 w-4" /> Shape
            </h3>
            <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
              Adjust the roundness of cards, buttons, and inputs.
            </p>
            <div className="grid grid-cols-5 gap-2">
              {RADIUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onRadiusChange(opt.value)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    radius === opt.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:bg-accent',
                  )}
                >
                  <div className="h-6 w-6 border-2 border-primary" style={{ borderRadius: `${opt.value}rem` }} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={onSave} disabled={!canEdit || busy}>
              {busy ? 'Saving…' : 'Save custom theme'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Live preview
        </p>
        <div
          style={{
            ...preview,
            backgroundColor: 'var(--preview-background)',
            color: 'var(--preview-text)',
            borderRadius: 'var(--preview-radius)',
          }}
          className="border p-4"
        >
          <div
            style={{
              backgroundColor: 'var(--preview-surface)',
              borderColor: 'var(--preview-border)',
              borderRadius: 'var(--preview-radius)',
            }}
            className="flex flex-col gap-3 border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Sample card</span>
              <StatusBadge tone="success">Active</StatusBadge>
            </div>
            <p style={{ color: 'var(--preview-muted-text)' }} className="text-sm">
              Live preview of your workspace theme.
            </p>
            <div className="flex gap-2">
              <span
                style={{
                  backgroundColor: 'var(--preview-primary)',
                  color: 'var(--preview-primary-foreground)',
                  borderRadius: 'var(--preview-radius)',
                }}
                className="px-3 py-1.5 text-sm font-medium"
              >
                Primary action
              </span>
              <span
                style={{ borderColor: 'var(--preview-border)', borderRadius: 'var(--preview-radius)' }}
                className="border px-3 py-1.5 text-sm font-medium"
              >
                Secondary
              </span>
            </div>
            <input
              readOnly
              value="Sample input"
              style={{ borderColor: 'var(--preview-border)', borderRadius: 'var(--preview-radius)' }}
              className="border bg-transparent px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function FontDialog({
  preset,
  current,
  canEdit,
  busy,
  onClose,
  onPreview,
  onSave,
}: {
  preset: ThemePreset
  current: string | null
  canEdit: boolean
  busy: boolean
  onClose: () => void
  onPreview: (font: string | null) => void
  onSave: (font: string | null) => void
}) {
  const [selected, setSelected] = useState<ThemeFontKey>(
    (current as ThemeFontKey | null) ?? preset.font,
  )
  const matchesTheme = selected === preset.font

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Typography for ${preset.label}`}
        description="Preview a face on the whole dashboard before you commit to it."
        className="max-w-xl"
      >
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {FONT_KEYS.map((key) => {
            const font = FONT_OPTIONS[key]
            const on = selected === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSelected(key)
                  onPreview(key === preset.font ? null : key)
                }}
                className={cn(
                  'flex w-full flex-col rounded-lg border p-3 text-left transition-colors',
                  on ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:bg-accent',
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium" style={{ fontFamily: fontStack(font) }}>
                    {font.family}
                    {key === preset.font && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        theme default
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{font.hint}</span>
                </span>
                <span
                  className="mt-1 text-sm text-muted-foreground"
                  style={{ fontFamily: fontStack(font) }}
                >
                  {PANGRAM}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={!canEdit || busy}
            onClick={() => onSave(matchesTheme ? null : selected)}
          >
            {busy ? 'Saving…' : 'Apply theme & font'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
