/**
 * Pipeline stages, and how they map onto the six legacy statuses.
 *
 * A studio's pipeline is data (crm_pipeline_stages); the six statuses are the
 * fixed vocabulary every report, filter, cadence and automation was written
 * against. The database derives status from a stage's kind and key
 * (crm_stage_status, 0038); this mirrors that rule so the UI can preview a
 * move and so a test can prove the two agree.
 */
export type LegacyStatus = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'converted' | 'lost'
export type StageKind = 'open' | 'won' | 'lost'

export interface StageLike {
  id: string
  key: string
  name: string
  kind: StageKind
  position: number
}

/** The six statuses, in pipeline order, with the labels the UI shows. */
export const LEGACY_STAGES: ReadonlyArray<{ key: LegacyStatus; label: string; kind: StageKind }> = [
  { key: 'new', label: 'New', kind: 'open' },
  { key: 'contacted', label: 'Contacted', kind: 'open' },
  { key: 'qualified', label: 'Qualified', kind: 'open' },
  { key: 'proposal_sent', label: 'Proposal sent', kind: 'open' },
  { key: 'converted', label: 'Won', kind: 'won' },
  { key: 'lost', label: 'Lost', kind: 'lost' },
]

export const LEGACY_STAGE_LABEL: Record<LegacyStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  proposal_sent: 'Proposal sent',
  converted: 'Won',
  lost: 'Lost',
}

const OPEN_LEGACY: readonly LegacyStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent']

export const isLegacyStatus = (v: unknown): v is LegacyStatus =>
  typeof v === 'string' && LEGACY_STAGES.some((s) => s.key === v)

const isOpenStatus = (s: LegacyStatus): boolean => s !== 'converted' && s !== 'lost'
const isOpenStage = (s: Pick<StageLike, 'kind'>): boolean => s.kind === 'open'

/** Stages in board order: by position, then by the order they were given. */
export function sortStages<T extends Pick<StageLike, 'position'>>(stages: readonly T[]): T[] {
  return stages.map((s, i) => [s, i] as const).sort((a, b) => a[0].position - b[0].position || a[1] - b[1]).map(([s]) => s)
}

/**
 * The legacy status a stage derives: won → converted, lost → lost, an open
 * stage by its key when it is a legacy key, else by its rank among the
 * pipeline's open stages, clamped to proposal_sent.
 */
export function statusForStage(stage: StageLike, pipelineStages: readonly StageLike[]): LegacyStatus {
  if (stage.kind === 'won') return 'converted'
  if (stage.kind === 'lost') return 'lost'
  if (isLegacyStatus(stage.key) && isOpenStatus(stage.key)) return stage.key
  const open = sortStages(pipelineStages.filter(isOpenStage))
  const rank = Math.max(0, open.findIndex((s) => s.id === stage.id))
  return OPEN_LEGACY[Math.min(rank, OPEN_LEGACY.length - 1)]!
}

/** The stage a legacy status lands in, mirroring crm_stage_for_status(). */
export function stageForStatus(status: LegacyStatus, pipelineStages: readonly StageLike[]): StageLike | null {
  const byKey = pipelineStages.find((s) => s.key === status)
  if (byKey) return byKey
  const sorted = sortStages(pipelineStages)
  if (status === 'converted') return sorted.find((s) => s.kind === 'won') ?? null
  if (status === 'lost') return sorted.find((s) => s.kind === 'lost') ?? null
  const open = sorted.filter(isOpenStage)
  const rank = OPEN_LEGACY.indexOf(status)
  return open[Math.min(Math.max(rank, 0), open.length - 1)] ?? null
}

/** The label a person sees for a deal: its own stage name when it has one, else the status. */
export function stageLabel(status: LegacyStatus, stageName: string | null | undefined): string {
  return stageName ?? LEGACY_STAGE_LABEL[status]
}

/** Which required fields a deal is still missing for a stage, in the words crm_move_stage uses. */
export function missingForStage(
  required: readonly string[],
  deal: {
    deal_value: number | null
    close_date: string | null
    email: string | null
    name: string | null
    assigned_to: string | null
    title: string | null
    lost_reason: string | null
  },
): string[] {
  return required.filter((f) => {
    switch (f) {
      case 'deal_value':
        return !deal.deal_value || deal.deal_value <= 0
      case 'close_date':
        return !deal.close_date
      case 'email':
        return !deal.email
      case 'name':
        return !deal.name
      case 'assigned_to':
        return !deal.assigned_to
      case 'title':
        return !deal.title
      case 'lost_reason':
        return !deal.lost_reason
      default:
        return false
    }
  })
}

export const REQUIRED_FIELD_LABEL: Record<string, string> = {
  deal_value: 'deal value',
  close_date: 'expected close date',
  email: 'email',
  name: 'name',
  assigned_to: 'owner',
  title: 'deal title',
  lost_reason: 'lost reason',
}
