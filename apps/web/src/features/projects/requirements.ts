import type { LibraryRole, ProductionStage } from '@ipc/contracts'
import { STAGE_LABEL, STAGE_ORDER, STAGE_TONE, stageOf } from '@/features/team/role-stages'
import type { Tone } from '@/shared/ui/tone-chip'

/**
 * What a shoot can ask for, grouped the way a studio plans a day: who preps
 * it, who is on the floor, who works it afterwards.
 *
 * Two sources feed it — the studio's own requirements (anything it has asked
 * for before, including ones typed by hand) and the standard role library —
 * and they used to be two flat lists of twenty-odd chips each, sorted by
 * nothing, so "Drone Operator" sat between "Sales" and "Album Designer".
 */
export interface RequirementOption {
  name: string
  stage: ProductionStage
  /** Something this studio has used before, rather than a library default. */
  saved: boolean
}

export interface RequirementGroup {
  stage: ProductionStage
  label: string
  tone: Tone
  options: RequirementOption[]
}

const key = (name: string) => name.trim().toLowerCase()

/**
 * One list, no duplicates. A name in both sources is one option: it keeps the
 * library's stage (which is curated) and is marked as the studio's own.
 */
export function requirementOptions(
  saved: readonly { name: string }[],
  library: readonly Pick<LibraryRole, 'type_name' | 'stage'>[],
): RequirementOption[] {
  const libStage = new Map(library.map((r) => [key(r.type_name), r.stage]))
  const out = new Map<string, RequirementOption>()
  for (const s of saved) {
    const name = s.name.trim()
    if (!name || out.has(key(name))) continue
    out.set(key(name), {
      name,
      stage: libStage.get(key(name)) ?? stageOf({ type_name: name, stage: null }),
      saved: true,
    })
  }
  for (const r of library) {
    const name = r.type_name.trim()
    if (!name || out.has(key(name))) continue
    out.set(key(name), { name, stage: r.stage, saved: false })
  }
  return [...out.values()]
}

/**
 * Options in stage order, each stage's own first then alphabetical. Stages
 * with nothing to offer are left out — a heading over nothing is noise here,
 * unlike on the roles page where an empty stage is the point.
 */
export function groupRequirementOptions(options: readonly RequirementOption[]): RequirementGroup[] {
  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    tone: STAGE_TONE[stage],
    options: options
      .filter((o) => o.stage === stage)
      .sort((a, b) => Number(b.saved) - Number(a.saved) || a.name.localeCompare(b.name)),
  })).filter((g) => g.options.length > 0)
}

/** The stage of a requirement already on a shoot, for colouring it. */
export function stageOfRequirement(
  name: string,
  options: readonly RequirementOption[],
): ProductionStage {
  return (
    options.find((o) => key(o.name) === key(name))?.stage ?? stageOf({ type_name: name, stage: null })
  )
}
