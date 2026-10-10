import { useState } from 'react'
import { Loader2, MapPin, Plus, Trash2, UserRound, Users } from 'lucide-react'
import type { AttendanceMode, AttendancePlace, AttendanceRule } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { useEmployeeRoles } from '@/features/team/api'
import { useMembers } from '@/features/allocation/api'
import { useDeletePlace, useDeleteRule, usePlaces, useRules, useSavePlace, useSaveRule } from './api'
import { readPosition } from './auto'

const MODE_LABEL: Record<AttendanceMode, string> = {
  required: 'At a place',
  anywhere: 'Anywhere',
  off: 'Not tracked',
}

/** "At Studio · 150 m", "Anywhere", "Not tracked". */
function ruleText(r: Pick<AttendanceRule, 'mode' | 'place_id' | 'radius_m'>, places: AttendancePlace[]): string {
  if (r.mode !== 'required') return MODE_LABEL[r.mode]
  const p = places.find((x) => x.id === r.place_id)
  const where = p ? `At ${p.name}` : 'At any studio place'
  const radius = r.radius_m ?? p?.radius_m
  return radius ? `${where} · ${radius} m` : where
}

/**
 * Where people can be marked present, and who must be where. The studio's
 * own spot is the location card above; these are the extra places (a second
 * office, an edit suite) and the rules per position or per person.
 */
export function PlacesAndRules({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <PlacesCard canEdit={canEdit} />
      <RulesCard canEdit={canEdit} />
    </div>
  )
}

function PlacesCard({ canEdit }: { canEdit: boolean }) {
  const places = usePlaces()
  const del = useDeletePlace()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)
  const list = places.data ?? []
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <IconTile icon={MapPin} tone="teal" size="sm" /> Places
        </CardTitle>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add a place
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Where someone can be marked present. The studio is set above.</p>
        {list.length === 0 && <p className="text-sm text-muted-foreground">Set the studio's location above first.</p>}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground">{p.radius_m} m</span>
              {!p.is_active && <StatusBadge tone="neutral">Off</StatusBadge>}
              {p.is_primary ? (
                <span className="ml-auto text-xs text-muted-foreground">the studio</span>
              ) : (
                canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-destructive hover:bg-destructive/10"
                    aria-label={`Remove ${p.name}`}
                    onClick={async () => {
                      if (await confirm({ title: `Remove ${p.name}?`, description: 'Rules that point at it fall back to any studio place.', confirmLabel: 'Remove', destructive: true }))
                        del.mutate(p.id)
                    }}
                  >
                    <Trash2 />
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
        {adding && <PlaceForm onDone={() => setAdding(false)} />}
      </CardContent>
    </Card>
  )
}

function PlaceForm({ onDone }: { onDone: () => void }) {
  const save = useSavePlace()
  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState('150')
  const [locating, setLocating] = useState(false)
  const filled = name.trim() && lat && lng && Number(radius) >= 20
  const nudge = (v: string) => (v.trim() ? 'border-success/50 bg-success/10' : 'border-warning/60 bg-warning/10')
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="place-name">Name</Label>
          <Input id="place-name" className={nudge(name)} value={name} onChange={(e) => setName(e.target.value)} placeholder="Edit suite" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="place-radius">Radius (m)</Label>
          <Input id="place-radius" type="number" min={20} max={5000} value={radius} onChange={(e) => setRadius(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="place-lat">Latitude</Label>
          <Input id="place-lat" className={cn('w-36', nudge(lat))} value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="place-lng">Longitude</Label>
          <Input id="place-lng" className={cn('w-36', nudge(lng))} value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locating}
          onClick={() => {
            setLocating(true)
            void readPosition()
              .then((p) => {
                setLat(p.coords.latitude.toFixed(6))
                setLng(p.coords.longitude.toFixed(6))
              })
              .catch(() => undefined)
              .finally(() => setLocating(false))
          }}
        >
          {locating ? <Loader2 className="animate-spin" /> : <MapPin />} I'm here
        </Button>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!filled || save.isPending}
          onClick={() =>
            save.mutate(
              { name: name.trim(), lat: Number(lat), lng: Number(lng), radius_m: Number(radius), is_active: true },
              { onSuccess: onDone },
            )
          }
        >
          Save place
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function RulesCard({ canEdit }: { canEdit: boolean }) {
  const rules = useRules()
  const places = usePlaces()
  const del = useDeleteRule()
  const [adding, setAdding] = useState<'role' | 'user' | null>(null)
  const list = rules.data ?? []
  const pl = places.data ?? []
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <IconTile icon={Users} tone="violet" size="sm" /> Who must be where
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Everyone in-house is marked at any studio place unless you say otherwise. Freelancers are not tracked daily.
        </p>
        {list.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                {r.scope === 'role' ? <Users className="size-4 text-muted-foreground" /> : <UserRound className="size-4 text-muted-foreground" />}
                <span className="font-medium">{r.label}</span>
                <span className="text-muted-foreground">{ruleText(r, pl)}</span>
                {canEdit && (
                  <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:bg-destructive/10" aria-label={`Remove the rule for ${r.label}`} onClick={() => del.mutate(r.id)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && !adding && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAdding('role')}>
              <Plus /> For a position
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding('user')}>
              <Plus /> For a person
            </Button>
          </div>
        )}
        {adding && <RuleForm scope={adding} places={pl} onDone={() => setAdding(null)} />}
      </CardContent>
    </Card>
  )
}

function RuleForm({ scope, places, onDone }: { scope: 'role' | 'user'; places: AttendancePlace[]; onDone: () => void }) {
  const roles = useEmployeeRoles()
  const members = useMembers()
  const save = useSaveRule()
  const [who, setWho] = useState('')
  const [mode, setMode] = useState<AttendanceMode>('required')
  const [place, setPlace] = useState('')
  const [radius, setRadius] = useState('')
  const options =
    scope === 'role'
      ? (roles.data ?? []).map((r) => ({ id: r.id, label: r.type_name }))
      : (members.data ?? []).filter((m) => m.role !== 'super_admin').map((m) => ({ id: m.user_id, label: m.name }))
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-who">{scope === 'role' ? 'Position' : 'Person'}</Label>
          <Select id="rule-who" className={who ? 'border-success/50 bg-success/10' : 'border-warning/60 bg-warning/10'} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{scope === 'role' ? 'Pick a position…' : 'Pick a person…'}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-mode">Marked</Label>
          <Select id="rule-mode" value={mode} onChange={(e) => setMode(e.target.value as AttendanceMode)}>
            <option value="required">At a place</option>
            <option value="anywhere">Anywhere</option>
            <option value="off">Not tracked</option>
          </Select>
        </div>
      </div>
      {mode === 'required' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-place">Place</Label>
            <Select id="rule-place" value={place} onChange={(e) => setPlace(e.target.value)}>
              <option value="">Any studio place</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-radius">Radius (m)</Label>
            <Input id="rule-radius" type="number" min={20} max={5000} value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="The place's own" />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!who || save.isPending}
          onClick={() =>
            save.mutate(
              {
                scope,
                role_id: scope === 'role' ? who : null,
                user_id: scope === 'user' ? who : null,
                mode,
                place_id: mode === 'required' && place ? place : null,
                radius_m: mode === 'required' && radius ? Number(radius) : null,
              },
              { onSuccess: onDone },
            )
          }
        >
          Save rule
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
