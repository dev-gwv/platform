/** What a day's crew costs: final amounts where agreed, the booking's estimate otherwise. */
export function crewTotal(slots: readonly { status: string; final_cost: number | null; estimated_cost: number | null; cost_status: string | null }[]) {
  let total = 0
  let unset = 0
  let tentative = false
  for (const s of slots) {
    if (s.status !== 'booked') continue
    const cost = s.final_cost ?? s.estimated_cost
    if (cost == null || cost <= 0) {
      unset++
      continue
    }
    total += cost
    if (s.cost_status !== 'final') tentative = true
  }
  return { total, unset, tentative }
}
