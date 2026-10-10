/**
 * The workflow language, in one place the UI and the tests can read.
 * The database runs workflows for real (0040 crm_run_enrollment); this
 * mirrors the condition rules so a workflow can be explained and previewed
 * before it is saved, and so the two cannot silently disagree.
 */
export type WorkflowTrigger = 'lead_created' | 'stage_changed' | 'follow_up_overdue' | 'activity_logged' | 'score_changed' | 'manual'
export type ConditionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'is_null' | 'not_null'
export type WorkflowAction =
  | 'assign_to'
  | 'set_follow_up_days'
  | 'mark_hot'
  | 'add_note'
  | 'notify_assignee'
  | 'notify_user'
  | 'start_cadence'
  | 'set_stage'
  | 'create_task'
  | 'add_score'
  | 'send_template'

export type ConditionValue = string | number | boolean | Array<string | number> | null | undefined

export interface FieldCondition {
  field: string
  op: ConditionOp
  value?: ConditionValue
}

export interface WorkflowConditionShape {
  source?: string | undefined
  to_status?: string | undefined
  from_status?: string | undefined
  is_hot?: boolean | undefined
  conditions?: FieldCondition[] | undefined
}

export const TRIGGER_LABEL: Record<WorkflowTrigger, string> = {
  lead_created: 'a lead arrives',
  stage_changed: 'a lead changes stage',
  follow_up_overdue: 'a follow-up is overdue',
  activity_logged: 'an activity is logged',
  score_changed: 'the score changes',
  manual: 'someone enrolls it by hand',
}

export const ACTION_LABEL: Record<WorkflowAction, string> = {
  assign_to: 'assign it to',
  set_follow_up_days: 'schedule a follow-up in',
  mark_hot: 'mark it hot',
  add_note: 'add a note',
  notify_assignee: 'notify the owner',
  notify_user: 'notify',
  start_cadence: 'start the cadence',
  set_stage: 'move it to',
  create_task: 'create a task',
  add_score: 'adjust the score by',
  send_template: 'send the template',
}

export const OP_LABEL: Record<ConditionOp, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  in: 'is one of',
  is_null: 'is empty',
  not_null: 'is set',
}

/** The lead facts a condition or a scoring rule may ask about (crm_lead_facts). */
export const CONDITION_FIELDS: ReadonlyArray<{ key: string; label: string; type: 'text' | 'number' | 'boolean' | 'date' }> = [
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'stage_key', label: 'Stage key', type: 'text' },
  { key: 'stage_kind', label: 'Stage kind (open/won/lost)', type: 'text' },
  { key: 'is_hot', label: 'Hot', type: 'boolean' },
  { key: 'score', label: 'Score', type: 'number' },
  { key: 'deal_value', label: 'Deal value', type: 'number' },
  { key: 'probability', label: 'Probability', type: 'number' },
  { key: 'has_email', label: 'Has an email', type: 'boolean' },
  { key: 'has_phone', label: 'Has a phone', type: 'boolean' },
  { key: 'assigned_to', label: 'Owner', type: 'text' },
  { key: 'days_since_created', label: 'Days since it arrived', type: 'number' },
  { key: 'days_since_contact', label: 'Days since last contact', type: 'number' },
  { key: 'inbound_replies', label: 'Replies received', type: 'number' },
  { key: 'activities_7d', label: 'Activities in the last 7 days', type: 'number' },
  { key: 'open_tasks', label: 'Open tasks', type: 'number' },
  { key: 'close_date', label: 'Expected close date', type: 'date' },
  { key: 'contact_lifecycle', label: 'Contact lifecycle', type: 'text' },
  { key: 'title', label: 'Deal title', type: 'text' },
]

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return null
}

/** One comparison, mirroring crm_cond_op(): numbers as numbers, else as text. */
export function conditionOp(left: unknown, op: ConditionOp, right: ConditionValue): boolean {
  if (op === 'is_null') return left === null || left === undefined
  if (op === 'not_null') return left !== null && left !== undefined
  if (left === null || left === undefined) return false
  const l = String(left)
  if (op === 'in') return Array.isArray(right) && right.some((r) => String(r) === l)
  if (op === 'contains') return l.toLowerCase().includes(String(right ?? '').toLowerCase())
  const ln = num(left)
  const rn = num(right)
  if (ln !== null && rn !== null && (typeof left !== 'string' || typeof right !== 'string')) {
    switch (op) {
      case 'eq':
        return ln === rn
      case 'neq':
        return ln !== rn
      case 'gt':
        return ln > rn
      case 'gte':
        return ln >= rn
      case 'lt':
        return ln < rn
      case 'lte':
        return ln <= rn
    }
  }
  const r = String(right ?? '')
  switch (op) {
    case 'eq':
      return l === r
    case 'neq':
      return l !== r
    case 'gt':
      return l > r
    case 'gte':
      return l >= r
    case 'lt':
      return l < r
    case 'lte':
      return l <= r
  }
  return false
}

/** Every clause must hold; an empty condition matches everything. */
export function workflowConditionMatches(cond: WorkflowConditionShape, facts: Record<string, unknown>, fromStatus: string | null = null): boolean {
  if (cond.source !== undefined && cond.source !== facts.source) return false
  if (cond.to_status !== undefined && cond.to_status !== facts.status) return false
  if (cond.from_status !== undefined && cond.from_status !== fromStatus) return false
  if (cond.is_hot !== undefined && cond.is_hot !== facts.is_hot) return false
  for (const c of cond.conditions ?? []) {
    if (!conditionOp(facts[c.field], c.op, c.value)) return false
  }
  return true
}

export interface Names {
  user?: ((id: string) => string | undefined) | undefined
  cadence?: ((id: string) => string | undefined) | undefined
  stage?: ((id: string) => string | undefined) | undefined
  template?: ((id: string) => string | undefined) | undefined
}

const fieldLabel = (key: string) => CONDITION_FIELDS.find((f) => f.key === key)?.label ?? key

function describeCondition(cond: WorkflowConditionShape, names: Names = {}): string {
  const clauses: string[] = []
  if (cond.source) clauses.push(`from ${cond.source}`)
  if (cond.from_status) clauses.push(`leaving ${cond.from_status}`)
  if (cond.to_status) clauses.push(`into ${cond.to_status}`)
  if (cond.is_hot !== undefined) clauses.push(cond.is_hot ? 'that is hot' : 'that is not hot')
  for (const c of cond.conditions ?? []) {
    const v = c.field === 'assigned_to' && typeof c.value === 'string' ? (names.user?.(c.value) ?? c.value) : c.value
    const shown = c.op === 'is_null' || c.op === 'not_null' ? '' : ` ${Array.isArray(v) ? v.join(', ') : String(v ?? '')}`
    clauses.push(`${fieldLabel(c.field)} ${OP_LABEL[c.op]}${shown}`)
  }
  return clauses.join(', ')
}

export type StepShape =
  | { kind: 'action'; config: { action: WorkflowAction } & Record<string, unknown> }
  | { kind: 'delay'; config: { amount: number; unit: 'minutes' | 'hours' | 'days' } }
  | { kind: 'branch'; config: { conditions: FieldCondition[]; yes_step: number | null; no_step: number | null } }
  | { kind: 'exit'; config: Record<string, never> | Record<string, unknown> }

/** One sentence per step: "assign it to Meera", "wait 3 days", "if Score is at least 40 → step 4, else step 5". */
export function describeStep(step: StepShape, names: Names = {}): string {
  if (step.kind === 'delay') return `wait ${step.config.amount} ${step.config.amount === 1 ? step.config.unit.slice(0, -1) : step.config.unit}`
  if (step.kind === 'exit') return 'stop here'
  if (step.kind === 'branch') {
    const cond = describeCondition({ conditions: step.config.conditions }, names)
    const yes = step.config.yes_step ? `step ${step.config.yes_step}` : 'the next step'
    const no = step.config.no_step ? `step ${step.config.no_step}` : 'the next step'
    return `if ${cond} → ${yes}, else → ${no}`
  }
  const c = step.config
  let does: string = ACTION_LABEL[c.action]
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined)
  const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : undefined)
  switch (c.action) {
    case 'assign_to':
    case 'notify_user':
      does += ` ${(str('user_id') && names.user?.(str('user_id')!)) ?? 'a teammate'}`
      break
    case 'set_follow_up_days': {
      const d = n('days') ?? 1
      does += ` ${d} day${d === 1 ? '' : 's'}`
      break
    }
    case 'add_note':
      if (str('note')) does += ` “${str('note')}”`
      break
    case 'start_cadence':
      does += ` “${(str('cadence_id') && names.cadence?.(str('cadence_id')!)) ?? 'follow-up'}”`
      break
    case 'set_stage':
      does += ` ${(str('stage_id') && names.stage?.(str('stage_id')!)) ?? 'a stage'}`
      break
    case 'create_task': {
      const d = n('days') ?? 0
      does += ` “${str('subject') ?? 'Follow up'}”${d ? ` due in ${d} day${d === 1 ? '' : 's'}` : ' due today'}`
      break
    }
    case 'add_score': {
      const p = n('points') ?? 0
      does += ` ${p >= 0 ? '+' : ''}${p}`
      break
    }
    case 'send_template':
      does += ` “${(str('template_id') && names.template?.(str('template_id')!)) ?? 'message'}”${str('channel') ? ` via ${str('channel')}` : ''}`
      break
    default:
      break
  }
  return does
}

/** "When a lead arrives from facebook: mark it hot; wait 2 days; notify the owner." */
export function describeWorkflow(w: { trigger: WorkflowTrigger; condition: WorkflowConditionShape; steps: StepShape[] }, names: Names = {}): string {
  const cond = describeCondition(w.condition, names)
  const head = `When ${TRIGGER_LABEL[w.trigger]}${cond ? ` ${cond}` : ''}`
  const body = w.steps.map((s) => describeStep(s, names)).join('; ')
  return `${head}: ${body || 'do nothing'}.`
}
