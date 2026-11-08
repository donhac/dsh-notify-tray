// Host wiring → public state route. No browser, tray helper, OS notification,
// background catalogue lookup, account polling or persistent ledger effects run.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const previousHome = process.env.DSH_HOME
const previousBurst = process.env.DSH_NOTIFY_TRAY_BURST_MS
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-goal-notifications-'))
process.env.DSH_NOTIFY_TRAY_BURST_MS = '0'
const { apply } = await import('../lib/index.js')

test.after(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (previousBurst === undefined) delete process.env.DSH_NOTIFY_TRAY_BURST_MS
  else process.env.DSH_NOTIFY_TRAY_BURST_MS = previousBurst
})

const vol = value => ({ get: () => value })
const user = { kind: 'user' }
const automatic = (revision = 1, round = 1) => ({ kind: 'goal', goalId: 'g1', revision, round })

function tape(id = 'S1', header = {}) {
  const history = []
  let deliver = () => {}
  const session = { id, header: { cwd: '/work/demo', ...header }, snapshotEvents: () => history.slice() }
  const agent = { id, session, status: 'idle' }
  const send = (type, data) => {
    const event = { type, data, seq: history.length + 1, time: Date.now() }
    history.push(event)
    deliver(session, event)
    return event
  }
  const message = (source = user) => send('user/message', {
    source,
    message: { id: `m-${history.length + 1}`, role: 'user', content: [{ type: 'text', text: '处理任务' }] },
  })
  const start = (turn, source = user) => {
    // A real user/message is claimed after turn/start, including Goal rounds.
    agent.status = 'running'
    send('turn/start', { turn })
    message(source)
  }
  const end = (turn, reason = { kind: 'completed' }) => {
    const event = send('turn/end', { turn, reason })
    agent.status = 'idle'
    return event
  }
  const change = (operation, revision = 1, phase = 'active', extra = {}) => send('goal/change', {
    operation, goal: operation === 'clear' ? null : { id: 'g1', revision, phase, ...extra },
  })
  return { session, agent, history, send, message, start, end, change, attach: fn => { deliver = fn } }
}

function host(t, initialAgents = []) {
  const handlers = new Map()
  const routes = new Map()
  const disposers = []
  const errors = []
  const services = {
    webServer: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    connection: { requestRejection: () => undefined },
  }
  const ctx = {
    agents: { list: () => initialAgents },
    on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list) },
    emit(name, ...args) { for (const fn of handlers.get(name) ?? []) fn(...args) },
    // Run route registration and notice disposal only. Other effects concern
    // external services or background timers, outside these host wiring tests.
    effect(fn, label) {
      if (label === 'notify-tray: notice queue' || label?.startsWith('notify-tray: GET ') || label?.startsWith('notify-tray: POST ')) {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
      }
    },
    inject(names, fn) { if (names.every(name => services[name])) fn(Object.assign(Object.create(ctx), services)) },
    logger: () => ({ warn: (...args) => errors.push(args), debug() {} }),
  }
  apply(ctx, {
    notifyCompleted: vol(true), notifyFailed: vol(true), notifyApproval: vol(true), notifyChoice: vol(true), notifyInput: vol(true),
    channel: vol('client'), tray: vol(false), suppressWhenFocused: vol(false), sound: vol(false),
    spendSource: vol('auto'), currency: vol('CNY'), prices: vol({}), errorHoldMinutes: vol(10),
    priceSource: vol('custom'), customPriceCurrency: vol('CNY'), exchangeRate: vol(7),
    planProvider: vol('none'), planAutoQuota: vol(false), quotaPollMinutes: vol(10), balancePollMinutes: vol(5),
  })
  t.after(() => {
    for (const dispose of disposers.reverse()) dispose()
    assert.deepEqual(errors, [], 'host must not hide event-processing errors')
  })
  const state = (after = 0) => {
    let body
    const res = { setHeader() {}, end(value) { body = JSON.parse(value) } }
    routes.get('/notify-tray/state').handler({ method: 'GET', url: `/notify-tray/state?after=${after}` }, res)
    assert.equal(res.statusCode, 200)
    return body
  }
  const attach = c => c.attach((session, event) => ctx.emit('session/event', session, event))
  const created = c => { attach(c); ctx.emit('agent/created', { agent: c.agent }) }
  return { ctx, state, attach, created }
}

function expectState(state, completed = 0, failed = 0) {
  assert.equal(state.summary.today.completed, completed)
  assert.equal(state.summary.today.failed, failed)
  assert.equal(state.summary.today.aborted, 0)
}

function shown(state) {
  return state.events.filter(event => event.kind === 'show')
}

test('installing the host during an active Goal recovers attribution and only exposes its final completion', t => {
  const c = tape()
  c.start(1)
  c.change('create')
  c.end(1)
  const h = host(t, [c.agent])
  h.attach(c)
  expectState(h.state())
  assert.deepEqual(h.state().events, [])
  c.start(2, automatic())
  c.end(2)
  expectState(h.state())
  assert.deepEqual(h.state().events, [])
  c.start(3, automatic(1, 2))
  c.change('complete', 2, 'complete')
  assert.deepEqual(h.state().events, [])
  c.end(3)
  expectState(h.state(), 1)
  assert.deepEqual(shown(h.state()).map(event => event.type), ['completed'])
})

test('installing after the Goal complete tool result still waits for the in-flight turn end', t => {
  const c = tape()
  c.start(1)
  c.change('create')
  c.change('complete', 2, 'complete')
  const h = host(t, [c.agent])
  h.attach(c)
  expectState(h.state())
  assert.deepEqual(shown(h.state()), [])
  c.end(1)
  expectState(h.state(), 1)
  assert.equal(shown(h.state()).length, 1)
})

test('agent/created restores the active automatic round of a future recovered session', t => {
  const h = host(t)
  const c = tape()
  c.start(1)
  c.change('create')
  c.end(1)
  c.start(2, automatic())
  h.created(c)
  expectState(h.state())
  assert.equal(h.state().summary.running, 1)
  c.end(2)
  expectState(h.state())
  assert.deepEqual(h.state().events, [])
  c.start(3, automatic(1, 2))
  c.change('complete', 2, 'complete')
  c.end(3)
  expectState(h.state(), 1)
  assert.equal(shown(h.state()).length, 1)
})

test('agent/created does not replay historical Goal completion or count a repeated historical turn end', t => {
  const h = host(t)
  const c = tape()
  c.start(1)
  c.change('create')
  c.change('complete', 2, 'complete')
  const ended = c.end(1)
  h.created(c)
  expectState(h.state())
  assert.deepEqual(h.state().events, [])
  h.ctx.emit('session/event', c.session, ended)
  c.send('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expectState(h.state())
  assert.deepEqual(h.state().events, [])
  c.start(2)
  c.end(2)
  expectState(h.state(), 1)
})

test('agent/created recovers a pending Goal completion and emits its final notice only once', t => {
  const h = host(t)
  const c = tape()
  c.start(1)
  c.change('create')
  c.change('complete', 2, 'complete')
  h.created(c)
  assert.deepEqual(shown(h.state()), [])
  c.end(1)
  c.send('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expectState(h.state(), 1)
  const notices = shown(h.state())
  assert.equal(notices.length, 1)
  assert.equal(notices[0].sessionId, 'S1')
  assert.equal(notices[0].type, 'completed')
  assert.ok(notices[0].display.body.includes('demo'))
  assert.deepEqual(h.state(h.state().seq).events, [], 'a later poll does not replay the notice')
})

test('agent/created also restores ended ordinary turns without replaying their old outcomes', t => {
  const h = host(t)
  const c = tape()
  c.start(1)
  const ended = c.end(1)
  c.start(2)
  const failed = c.end(2, { kind: 'error', error: { message: '历史网络错误' } })
  h.created(c)
  h.ctx.emit('session/event', c.session, ended)
  h.ctx.emit('session/event', c.session, failed)
  expectState(h.state())
  assert.deepEqual(h.state().summary.recent, [])
  assert.deepEqual(h.state().events, [])
  c.start(3)
  c.end(3)
  expectState(h.state(), 1)
})

test('agent/created accepts an older SDK session without snapshotEvents', t => {
  const h = host(t)
  const c = tape('legacy')
  delete c.session.snapshotEvents
  h.created(c)
  c.start(1)
  c.end(1)
  expectState(h.state(), 1)
  assert.equal(shown(h.state())[0].sessionId, 'legacy')
})

test('agent/created keeps a restored Goal separate from another ordinary session', t => {
  const h = host(t)
  const goal = tape('goal-session')
  goal.start(1)
  goal.change('create')
  goal.end(1)
  const ordinary = tape('ordinary-session')
  h.created(goal)
  h.created(ordinary)
  goal.start(2, automatic())
  ordinary.start(1)
  goal.end(2)
  ordinary.end(1)
  expectState(h.state(), 1)
  assert.deepEqual(shown(h.state()).map(event => event.sessionId), ['ordinary-session'])
})

test('agent/created child Goal history and live events remain excluded', t => {
  const h = host(t)
  const child = tape('child', { delegationDepth: 1, origin: 'subagent' })
  child.start(1)
  child.change('create')
  h.created(child)
  child.change('complete', 2, 'complete')
  child.end(1)
  child.start(2, automatic(2, 1))
  child.end(2, { kind: 'error', error: { message: '子任务错误' } })
  expectState(h.state())
  assert.equal(h.state().summary.running, 0)
  assert.deepEqual(h.state().events, [])
})

test('agent/created restores a pending Goal block as a failure at normal turn end', t => {
  const h = host(t)
  const c = tape()
  c.start(1)
  c.change('create')
  c.change('block', 2, 'blocked', { blockedReason: { code: 'file-missing', message: '缺少所需的设计文件' } })
  h.created(c)
  expectState(h.state())
  assert.deepEqual(shown(h.state()), [])
  c.end(1)
  expectState(h.state(), 0, 1)
  assert.equal(shown(h.state())[0].type, 'failed')
  assert.match(shown(h.state())[0].body, /缺少所需的设计文件/u)
})

test('human steering after agent/created does not detach the restored automatic Goal round', t => {
  const h = host(t)
  const c = tape()
  c.start(1)
  c.change('create')
  c.end(1)
  c.start(2, automatic())
  h.created(c)
  c.message(user)
  c.end(2)
  expectState(h.state())
  assert.deepEqual(h.state().events, [])
})

test('a Goal completed before agent/created can resume and produce one new completion notice', t => {
  const h = host(t)
  const c = tape()
  c.start(1)
  c.change('create')
  c.change('complete', 2, 'complete')
  c.end(1)
  h.created(c)
  c.start(2)
  c.change('resume', 3, 'active')
  c.end(2)
  expectState(h.state())
  c.start(3, automatic(3, 1))
  c.change('complete', 4, 'complete')
  c.end(3)
  expectState(h.state(), 1)
  assert.equal(shown(h.state()).length, 1)
})
