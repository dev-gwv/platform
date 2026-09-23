import type { EmployeeRole, ProductionStage } from '@ipc/contracts'
import type { Tone } from '@/shared/ui/tone-chip'

/**
 * Job roles, grouped by the part of the job they belong to.
 *
 * A studio with twenty roles has a flat alphabetical list where "Album
 * Designer" sits above "Assistant Photographer" — two people who never work the
 * same day. Grouped by stage, the list reads the way the work runs: who plans
 * it, who shoots it, who edits it.
 *
 * The stage is stored on the role, but it is allowed to be unset — roles
 * created before the column existed have none, and nobody should have to open
 * twenty dialogs to fix that. Those are read off the name instead.
 */
export const STAGE_LABEL: Record<ProductionStage, string> = {
  pre: 'Pre-production',
  production: 'On production',
  post: 'Post-production',
  other: 'Management & other',
}

export const STAGE_ORDER: readonly ProductionStage[] = ['pre', 'production', 'post', 'other']

/**
 * One colour per stage, used wherever roles appear grouped, so "violet" means
 * pre-production on the team page and in the shoot picker alike.
 */
export const STAGE_TONE: Record<ProductionStage, Tone> = {
  pre: 'violet',
  production: 'blue',
  post: 'green',
  other: 'amber',
}

/**
 * Name → stage, first match wins. Ordered most specific first: "Album
 * Designer" is post-production, and must be decided before the looser
 * "designer"-ish patterns further down could claim it.
 */
const BY_NAME: ReadonlyArray<readonly [RegExp, ProductionStage]> = [
  [/operations manager|^manager$/, 'other'],
  [/colou?rist|colou?r grade/, 'post'],
  [/album designer/, 'post'],
  [/data manager|digital asset/, 'post'],
  [/same.?day.*editor/, 'post'],
  // Any editor edits after the shoot: "Highlight Editor", "Reel Editor", a
  // studio's own name for the job, not only the four the library ships with.
  [/editor|editing|retouch/, 'post'],
  [/bts|behind the scenes/, 'production'],
  [/mobile.*(cinematograph|shoot)/, 'production'],
  [/drone/, 'production'],
  [/cinematograph/, 'production'],
  [/candid/, 'production'],
  [/traditional/, 'production'],
  [/videograph/, 'production'],
  [/light/, 'production'],
  [/photograph/, 'production'],
  [/sales|client coordinator|planner|script|concept|creative director/, 'pre'],
]

/** The stage a role belongs to: what it was saved as, or what its name says. */
export function stageOf(role: Pick<EmployeeRole, 'type_name' | 'stage'>): ProductionStage {
  if (role.stage) return role.stage
  const name = role.type_name.trim().toLowerCase()
  for (const [pattern, stage] of BY_NAME) if (pattern.test(name)) return stage
  return 'other'
}

/**
 * Every stage in running order, each with its roles. Empty stages come back
 * too: the page renders them as a heading with a "nothing here yet" line, so a
 * studio can see it has no post-production roles rather than not noticing.
 */
export function byStage<T extends Pick<EmployeeRole, 'type_name' | 'stage'>>(
  roles: readonly T[],
): { stage: ProductionStage; label: string; roles: T[] }[] {
  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    roles: roles.filter((r) => stageOf(r) === stage),
  }))
}
