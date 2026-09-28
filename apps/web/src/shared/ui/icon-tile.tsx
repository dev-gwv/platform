import {
  Baby,
  BookOpen,
  Briefcase,
  Cake,
  Camera,
  Clapperboard,
  Film,
  Flower2,
  Gem,
  HardDrive,
  Heart,
  Image as ImageIcon,
  MapPin,
  Music,
  Package,
  PartyPopper,
  Plane,
  Printer,
  Scissors,
  Sparkles,
  Sun,
  User,
  UserPlus,
  UserRound,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { deliverableKind, eventKind, roleKind, type DeliverableKind, type EventKind, type RoleKind } from '@/shared/kinds'
import { cn } from './cn'

/**
 * The small picture tile the owner liked on deliverables, for everything that
 * has a kind: shoots and events, crew roles, deliverables, money rows. Each
 * kind keeps one icon and one colour everywhere, so a haldi is always the
 * yellow sun and a drone always the teal plane.
 */
export type Tone = 'blue' | 'green' | 'violet' | 'amber' | 'rose' | 'teal' | 'muted'

const TONE: Record<Tone, string> = {
  blue: 'bg-tone-blue-soft text-tone-blue',
  green: 'bg-tone-green-soft text-tone-green',
  violet: 'bg-tone-violet-soft text-tone-violet',
  amber: 'bg-tone-amber-soft text-tone-amber',
  rose: 'bg-tone-rose-soft text-tone-rose',
  teal: 'bg-tone-teal-soft text-tone-teal',
  muted: 'bg-muted text-muted-foreground',
}

const SIZE = {
  sm: { box: 'size-7 rounded-lg', icon: 'size-3.5' },
  md: { box: 'size-9 rounded-xl', icon: 'size-4' },
  lg: { box: 'size-12 rounded-xl', icon: 'size-6' },
} as const

export function IconTile({
  icon: Icon,
  tone = 'muted',
  size = 'md',
  className,
}: {
  icon: LucideIcon
  tone?: Tone
  size?: keyof typeof SIZE
  className?: string
}) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center', SIZE[size].box, TONE[tone], className)} aria-hidden>
      <Icon className={SIZE[size].icon} />
    </span>
  )
}

export const DELIVERABLE_ICON: Record<DeliverableKind, LucideIcon> = {
  album: BookOpen,
  reel: Clapperboard,
  film: Film,
  photos: ImageIcon,
  print: Printer,
  data: HardDrive,
  other: Package,
}
const DELIVERABLE_TONE: Record<DeliverableKind, Tone> = {
  album: 'violet',
  reel: 'rose',
  film: 'blue',
  photos: 'teal',
  print: 'amber',
  data: 'muted',
  other: 'muted',
}

export const EVENT_ICON: Record<EventKind, LucideIcon> = {
  prewedding: MapPin,
  engagement: Gem,
  haldi: Sun,
  mehendi: Flower2,
  sangeet: Music,
  reception: PartyPopper,
  wedding: Heart,
  baby: Baby,
  birthday: Cake,
  corporate: Briefcase,
  portrait: UserRound,
  product: Package,
  other: Camera,
}
const EVENT_TONE: Record<EventKind, Tone> = {
  prewedding: 'teal',
  engagement: 'violet',
  haldi: 'amber',
  mehendi: 'green',
  sangeet: 'blue',
  reception: 'violet',
  wedding: 'rose',
  baby: 'teal',
  birthday: 'amber',
  corporate: 'blue',
  portrait: 'violet',
  product: 'green',
  other: 'blue',
}

export const ROLE_ICON: Record<RoleKind, LucideIcon> = {
  drone: Plane,
  video: Video,
  photo: Camera,
  album: BookOpen,
  editor: Scissors,
  director: Sparkles,
  assistant: UserPlus,
  other: User,
}
const ROLE_TONE: Record<RoleKind, Tone> = {
  drone: 'teal',
  video: 'rose',
  photo: 'blue',
  album: 'violet',
  editor: 'amber',
  director: 'violet',
  assistant: 'green',
  other: 'muted',
}

type TileProps = { size?: keyof typeof SIZE; className?: string }

/** A shoot or event by its name: "Haldi" -> sun, "Reception" -> party popper. */
export function EventTile({ name, ...p }: { name: string | null | undefined } & TileProps) {
  const k = eventKind(name)
  return <IconTile icon={EVENT_ICON[k]} tone={EVENT_TONE[k]} {...p} />
}

/** A crew role: "Drone operator" -> plane, "Album designer" -> book. */
export function RoleTile({ name, ...p }: { name: string | null | undefined } & TileProps) {
  const k = roleKind(name)
  return <IconTile icon={ROLE_ICON[k]} tone={ROLE_TONE[k]} {...p} />
}

/** A deliverable by its title, in its kind's own colour (no stage). */
export function DeliverableTile({ title, ...p }: { title: string | null | undefined } & TileProps) {
  const k = deliverableKind(title)
  return <IconTile icon={DELIVERABLE_ICON[k]} tone={DELIVERABLE_TONE[k]} {...p} />
}

const TEXT: Record<Tone, string> = {
  blue: 'text-tone-blue',
  green: 'text-tone-green',
  violet: 'text-tone-violet',
  amber: 'text-tone-amber',
  rose: 'text-tone-rose',
  teal: 'text-tone-teal',
  muted: 'text-muted-foreground',
}

/** Just the coloured icon, for inside a chip or button: "☀ Haldi". */
export function EventIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const k = eventKind(name)
  const Icon = EVENT_ICON[k]
  return <Icon className={cn(TEXT[EVENT_TONE[k]], className)} aria-hidden />
}
