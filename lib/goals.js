/** Derived Goal ownership for one session. Pure log fold; never drives or mutates a Goal. */
export const DUPLICATE_END = Symbol('duplicate turn/end')

export class GoalRuns {
  constructor() {
    this.goal = undefined
    this.open = false
    this.owner = undefined
    this.endedTurn = undefined
    this.completed = new Map()
  }

  observe(event) {
    const data = event.data ?? {}
    if (event.type === 'turn/start') {
      this.open = true
      this.owner = undefined
    } else if (event.type === 'user/message' && data.source?.kind === 'goal') {
      // Source attribution, rather than a stale active Goal, owns this round.
      this.owner = data.source.goalId
      this.open = true
      if (this.goal?.id !== this.owner) this.goal = { id: this.owner, phase: 'active', revision: data.source.revision }
    } else if (event.type === 'goal/change') {
      const previous = this.goal
      if (data.operation === 'clear') {
        if (this.open) this.owner = previous?.id ?? this.owner
        this.goal = undefined
      } else if (data.goal?.id && ['active', 'paused', 'blocked', 'complete'].includes(data.goal.phase)) {
        this.goal = data.goal
        if (this.open) this.owner = data.goal.id
      }
    }
    // Human steering inside an owned round must not detach it. A fresh human
    // turn stays unowned until a Goal operation explicitly associates it.
  }

  end(data, outcome) {
    if (Number.isSafeInteger(data.turn)) {
      if (this.endedTurn !== undefined && data.turn <= this.endedTurn) return DUPLICATE_END
      this.endedTurn = data.turn
    }
    const owner = this.owner
    this.open = false
    this.owner = undefined
    // Failure and cancellation remain visible regardless of Goal phase.
    if (outcome?.kind !== 'completed' || !owner) return outcome
    if (this.goal?.id !== owner) return undefined // cleared/replaced Goal
    if (this.goal.phase === 'blocked') return { kind: 'failed', detail: this.goal.blockedReason?.message || '目标受阻，需要处理后继续' }
    if (this.goal.phase !== 'complete') return undefined
    const revision = this.goal.revision ?? 0
    if ((this.completed.get(owner) ?? -1) >= revision) return undefined
    this.completed.set(owner, revision)
    return outcome
  }

  /** Restore attribution and dedupe only, without counters, notices or side effects. */
  seed(events, outcomeOf) {
    for (const event of events) {
      this.observe(event)
      if (event.type === 'turn/end') this.end(event.data ?? {}, outcomeOf(event.data?.reason))
    }
  }
}
