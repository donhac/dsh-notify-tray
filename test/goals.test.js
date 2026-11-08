import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Tracker } from '../lib/tracker.js'

// Exercise only the public Tracker API with the events persisted by DSH. Each
// session has increasing event seqs; Goal revisions change independently of turns.
const user = { kind: 'user' }
const goalSource = (revision = 1, round = 1, goalId = 'g1') => ({ kind: 'goal', goalId, revision, round })
const completed = { kind: 'completed' }

function conversation({ id = 'S1', header = {}, tracker = new Tracker(), history = [] } = {}) {
  let seq = history.reduce((max, event) => Math.max(max, event.seq), 0)
  const session = { id, header: { cwd: '/work/demo', ...header }, snapshotEvents: () => history.slice() }
  const agent = { id, session, status: 'idle' }
  const send = (type, data) => {
    const event = { type, data, seq: ++seq, time: Date.now() }
    history.push(event)
    tracker.sessionEvent(session, event)
    return event
  }
  const message = (source = user, text = '继续处理') => send('user/message', {
    source,
    message: { id: `m-${seq + 1}`, role: 'user', content: [{ type: 'text', text }] },
  })
  const start = (turn, source = user) => {
    // DSH opens the turn before claiming its queued user message into the log.
    send('turn/start', { turn })
    message(source)
    agent.status = 'running'
    tracker.agentStatus(agent, 'running')
  }
  const end = (turn, reason = completed) => {
    const event = send('turn/end', { turn, reason })
    agent.status = 'idle'
    tracker.agentStatus(agent, 'idle')
    return event
  }
  const change = (operation, revision = 1, phase = 'active', extra = {}, goalId = 'g1') => send('goal/change', {
    operation,
    goal: operation === 'clear' ? null : { id: goalId, revision, phase, ...extra },
  })
  return { tracker, session, agent, history, send, message, start, end, change }
}

function outcomes(tracker) {
  return tracker.eventsAfter(0).filter(event => event.type === 'completed' || event.type === 'failed')
}

function expectCounts(tracker, { completed = 0, failed = 0, aborted = 0 } = {}) {
  const today = tracker.summary().today
  assert.deepEqual({ completed: today.completed, failed: today.failed, aborted: today.aborted }, { completed, failed, aborted })
}

function expectQuiet(tracker) {
  assert.deepEqual(outcomes(tracker), [])
  expectCounts(tracker)
  assert.deepEqual(tracker.summary().recent, [])
}

function activeGoal(options) {
  const c = conversation(options)
  c.start(1)
  c.change('create')
  return c
}

test('ordinary human turns still notify and count once per completed answer', () => {
  const c = conversation()
  c.start(1)
  c.end(1)
  c.start(2)
  c.end(2)
  assert.deepEqual(outcomes(c.tracker).map(event => event.type), ['completed', 'completed'])
  expectCounts(c.tracker, { completed: 2 })
  assert.equal(c.tracker.summary().recent[0].kind, 'completed')
})

test('creating a Goal makes its first completed turn an intermediate round', () => {
  const c = activeGoal()
  c.end(1)
  expectQuiet(c.tracker)
})

test('many automatic rounds of one active Goal never produce completion statistics or recent results', () => {
  const c = activeGoal()
  c.end(1)
  for (let turn = 2; turn <= 5; turn += 1) {
    c.start(turn, goalSource(1, turn - 1))
    c.end(turn)
    expectQuiet(c.tracker)
  }
})

test('Goal phase complete waits for its final turn/end before notifying', () => {
  const c = activeGoal()
  c.end(1)
  c.start(2, goalSource())
  c.change('complete', 2, 'complete')
  expectQuiet(c.tracker)
  assert.equal(c.tracker.summary().running, 1)
  c.end(2)
  assert.deepEqual(outcomes(c.tracker).map(event => event.type), ['completed'])
  expectCounts(c.tracker, { completed: 1 })
  assert.equal(c.tracker.summary().recent[0].kind, 'completed')
})

test('a Goal created and completed in one human turn still waits for turn/end', () => {
  const c = activeGoal()
  c.change('complete', 2, 'complete')
  expectQuiet(c.tracker)
  c.end(1)
  expectCounts(c.tracker, { completed: 1 })
  assert.equal(outcomes(c.tracker).length, 1)
})

test('a delayed repeated Goal completion event cannot notify before another end or recount the same completion revision', () => {
  const c = activeGoal()
  c.change('complete', 2, 'complete')
  c.end(1)
  c.change('complete', 2, 'complete')
  assert.equal(outcomes(c.tracker).length, 1)
  c.start(2, goalSource(2, 1))
  c.end(2)
  expectCounts(c.tracker, { completed: 1 })
  assert.equal(outcomes(c.tracker).length, 1)
})

test('a later automatic round cannot announce an already completed Goal again', () => {
  const c = activeGoal()
  c.change('complete', 2, 'complete')
  c.end(1)
  c.start(2, goalSource(2, 1))
  c.change('complete', 2, 'complete')
  c.end(2)
  assert.equal(outcomes(c.tracker).length, 1)
  expectCounts(c.tracker, { completed: 1 })
})

test('human steering inside an automatic Goal turn does not detach it from the Goal', () => {
  const c = activeGoal()
  c.end(1)
  c.start(2, goalSource())
  c.message(user, '请优先修复边界情况')
  c.end(2)
  expectQuiet(c.tracker)
  c.start(3, goalSource(1, 2))
  c.change('complete', 2, 'complete')
  c.end(3)
  expectCounts(c.tracker, { completed: 1 })
})

test('human steering inside the turn that creates a Goal preserves its attribution', () => {
  const c = activeGoal()
  c.message(user, '补充一个要求')
  c.end(1)
  expectQuiet(c.tracker)
})

for (const phase of ['active', 'paused', 'complete']) {
  test(`a new independent human turn completes normally despite a leftover ${phase} Goal`, () => {
    const c = activeGoal()
    if (phase === 'paused') c.change('pause', 2, phase)
    if (phase === 'complete') c.change('complete', 2, phase)
    c.end(1)
    const before = c.tracker.summary().today.completed
    const beforeEvents = outcomes(c.tracker).length
    c.start(2, user)
    c.end(2)
    expectCounts(c.tracker, { completed: before + 1 })
    assert.equal(outcomes(c.tracker).length, beforeEvents + 1)
    assert.equal(outcomes(c.tracker).at(-1).type, 'completed')
  })
}

for (const operation of ['edit', 'resume']) {
  test(`a human turn that ${operation}s a leftover Goal belongs to that Goal again`, () => {
    const c = activeGoal()
    if (operation === 'resume') c.change('pause', 2, 'paused')
    c.end(1)
    c.start(2)
    c.change(operation, 3, 'active')
    c.end(2)
    expectQuiet(c.tracker)
    c.start(3, goalSource(3, 1))
    c.change('complete', 4, 'complete')
    c.end(3)
    expectCounts(c.tracker, { completed: 1 })
  })
}

test('a human turn that explicitly completes a leftover Goal notifies at the end', () => {
  const c = activeGoal()
  c.end(1)
  c.start(2)
  c.change('complete', 2, 'complete')
  expectQuiet(c.tracker)
  c.end(2)
  expectCounts(c.tracker, { completed: 1 })
})

for (const [name, reason, detail] of [
  ['error', { kind: 'error', error: { message: '服务暂时不可用' } }, /服务暂时不可用/u],
  ['max-tokens', { kind: 'max-tokens' }, /长度|上限|token/iu],
  ['blocked', { kind: 'blocked' }, /拦截|阻塞|blocked/iu],
]) {
  test(`an active Goal round ending with ${name} still notifies failed`, () => {
    const c = activeGoal()
    c.end(1)
    c.start(2, goalSource())
    c.end(2, reason)
    expectCounts(c.tracker, { failed: 1 })
    assert.deepEqual(outcomes(c.tracker).map(event => event.type), ['failed'])
    assert.match(outcomes(c.tracker)[0].body, detail)
    assert.equal(c.tracker.summary().recent[0].kind, 'failed')
  })
}

test('an error after the complete tool event reports failure instead of premature success', () => {
  const c = activeGoal()
  c.change('complete', 2, 'complete')
  c.end(1, { kind: 'error', error: { message: '最后一步验证失败' } })
  expectCounts(c.tracker, { failed: 1 })
  assert.deepEqual(outcomes(c.tracker).map(event => event.type), ['failed'])
  assert.match(outcomes(c.tracker)[0].body, /最后一步验证失败/u)
})

test('Goal block followed by a normal turn end emits failed with the concrete blocking reason', () => {
  const c = activeGoal()
  c.end(1)
  c.start(2, goalSource())
  c.change('block', 2, 'blocked', { blockedReason: { code: 'missing-credential', message: '缺少发布所需的访问密钥' } })
  expectQuiet(c.tracker)
  c.end(2)
  expectCounts(c.tracker, { failed: 1 })
  assert.deepEqual(outcomes(c.tracker).map(event => event.type), ['failed'])
  assert.match(outcomes(c.tracker)[0].body, /缺少发布所需的访问密钥/u)
})

for (const operation of ['pause', 'clear']) {
  test(`Goal ${operation} during an attributed turn cannot masquerade as a successful completion`, () => {
    const c = activeGoal()
    c.end(1)
    c.start(2, goalSource())
    c.change(operation, 2, 'paused')
    c.end(2)
    expectQuiet(c.tracker)
    c.start(3)
    c.end(3)
    expectCounts(c.tracker, { completed: 1 })
  })
}

test('a completed Goal resumed at a new revision can complete and notify again', () => {
  const c = activeGoal()
  c.change('complete', 2, 'complete')
  c.end(1)
  c.start(2)
  c.change('resume', 3, 'active')
  c.end(2)
  expectCounts(c.tracker, { completed: 1 })
  c.start(3, goalSource(3, 1))
  c.change('complete', 4, 'complete')
  c.end(3)
  expectCounts(c.tracker, { completed: 2 })
  assert.deepEqual(outcomes(c.tracker).map(event => event.type), ['completed', 'completed'])
})

test('a blocked Goal resumed by the human can complete after another automatic round', () => {
  const c = activeGoal()
  c.change('block', 2, 'blocked', { blockedReason: { code: 'waiting', message: '等待用户提供文件' } })
  c.end(1)
  c.start(2)
  c.change('resume', 3, 'active')
  c.end(2)
  expectCounts(c.tracker, { failed: 1 })
  c.start(3, goalSource(3, 1))
  c.change('complete', 4, 'complete')
  c.end(3)
  expectCounts(c.tracker, { completed: 1, failed: 1 })
})

for (const reason of [completed, { kind: 'error', error: { message: '网络错误' } }, { kind: 'aborted', reason: { kind: 'user' } }]) {
  test(`duplicate ordinary ${reason.kind} turn/end events count the turn only once even with a new seq`, () => {
    const c = conversation()
    c.start(1)
    const original = c.end(1, reason)
    c.tracker.sessionEvent(c.session, original)
    c.send('turn/end', { turn: 1, reason })
    expectCounts(c.tracker, reason.kind === 'completed' ? { completed: 1 } : reason.kind === 'error' ? { failed: 1 } : { aborted: 1 })
    assert.equal(outcomes(c.tracker).length, reason.kind === 'aborted' ? 0 : 1)
  })
}

test('a duplicate final Goal turn/end never duplicates notifications or statistics', () => {
  const c = activeGoal()
  c.change('complete', 2, 'complete')
  const original = c.end(1)
  c.tracker.sessionEvent(c.session, original)
  c.send('turn/end', { turn: 1, reason: completed })
  expectCounts(c.tracker, { completed: 1 })
  assert.equal(outcomes(c.tracker).length, 1)
})

test('interleaved top-level sessions keep Goal attribution and independent completion counts separate', () => {
  const tracker = new Tracker()
  const goal = activeGoal({ tracker })
  const ordinary = conversation({ tracker, id: 'S2' })
  ordinary.start(1)
  goal.end(1)
  ordinary.end(1)
  goal.start(2, goalSource())
  goal.change('complete', 2, 'complete')
  goal.end(2)
  expectCounts(tracker, { completed: 2 })
  assert.deepEqual(outcomes(tracker).map(event => event.sessionId), ['S2', 'S1'])
})

for (const header of [{ delegationDepth: 1 }, { origin: 'subagent' }]) {
  test(`Goal activity in a child session (${Object.keys(header)[0]}) never notifies or changes top-level statistics`, () => {
    const c = activeGoal({ id: 'child', header })
    c.change('complete', 2, 'complete')
    c.end(1)
    c.start(2, goalSource(2, 1))
    c.end(2, { kind: 'error', error: { message: 'child failure' } })
    expectQuiet(c.tracker)
    assert.equal(c.tracker.summary().running, 0)
  })
}

test('Goal intermediate rounds do not erase an earlier visible failed result', () => {
  const c = conversation()
  c.start(1)
  c.end(1, { kind: 'error', error: { message: '首轮失败' } })
  c.start(2)
  c.change('create')
  c.end(2)
  c.start(3, goalSource())
  c.end(3)
  expectCounts(c.tracker, { failed: 1 })
  assert.equal(c.tracker.summary().recent[0].kind, 'failed')
  assert.equal(outcomes(c.tracker).length, 1)
})

test('approval and input notifications remain available while a Goal runs', () => {
  const c = activeGoal()
  c.send('approval/asked', { id: 'a1', callId: 'b1', toolName: 'bash', reason: '批准发布' })
  c.send('approval/decided', { id: 'a1', outcome: 'allowed-once' })
  c.send('tool/call', { callId: 'q1', name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ question: '文件在哪？' }] }) })
  assert.equal(c.tracker.summary().waiting.length, 1)
  c.send('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'q1', source: { kind: 'tool', callId: 'q1' } } })
  c.end(1)
  assert.deepEqual(c.tracker.eventsAfter(0).map(event => event.type), ['approval', 'input'])
  assert.deepEqual(c.tracker.summary().waiting, [])
  expectCounts(c.tracker)
})

test('seed restores an active automatic round from history without replaying notifications or statistics', () => {
  const prior = activeGoal()
  prior.end(1)
  prior.start(2, goalSource())
  const tracker = new Tracker()
  const c = conversation({ tracker, history: prior.history.slice() })
  c.agent.status = 'running'
  tracker.seed([c.agent])
  expectQuiet(tracker)
  assert.equal(tracker.summary().running, 1)
  c.end(2)
  expectQuiet(tracker)
  c.start(3, goalSource(1, 2))
  c.change('complete', 2, 'complete')
  c.end(3)
  expectCounts(tracker, { completed: 1 })
})

test('seed restores a complete event whose final turn/end has not yet arrived', () => {
  const prior = activeGoal()
  prior.change('complete', 2, 'complete')
  const tracker = new Tracker()
  const c = conversation({ tracker, history: prior.history.slice() })
  c.agent.status = 'running'
  tracker.seed([c.agent])
  expectQuiet(tracker)
  c.end(1)
  expectCounts(tracker, { completed: 1 })
  assert.equal(outcomes(tracker).length, 1)
})

test('seed remembers historical ended turns and completed Goal revisions without counting or replaying them', () => {
  const prior = activeGoal()
  prior.change('complete', 2, 'complete')
  const ended = prior.end(1)
  const tracker = new Tracker()
  const c = conversation({ tracker, history: prior.history.slice() })
  tracker.seed([c.agent])
  expectQuiet(tracker)
  tracker.sessionEvent(c.session, ended)
  c.send('turn/end', { turn: 1, reason: completed })
  c.start(2, goalSource(2, 1))
  c.change('complete', 2, 'complete')
  c.end(2)
  expectQuiet(tracker)
})

test('seed prevents replayed ordinary historical completions and failures from being counted', () => {
  const prior = conversation()
  prior.start(1)
  const success = prior.end(1)
  prior.start(2)
  const failure = prior.end(2, { kind: 'error', error: { message: '历史失败' } })
  const tracker = new Tracker()
  const c = conversation({ tracker, history: prior.history.slice() })
  tracker.seed([c.agent])
  expectQuiet(tracker)
  tracker.sessionEvent(c.session, success)
  tracker.sessionEvent(c.session, failure)
  expectQuiet(tracker)
  c.start(3)
  c.end(3)
  expectCounts(tracker, { completed: 1 })
})

test('seed reads snapshotEvents without mutating persisted history', () => {
  const prior = activeGoal()
  prior.end(1)
  const original = JSON.stringify(prior.history)
  for (const event of prior.history) {
    if (event.data.goal) Object.freeze(event.data.goal)
    Object.freeze(event.data)
    Object.freeze(event)
  }
  Object.freeze(prior.history)
  const tracker = new Tracker()
  const session = { ...prior.session, snapshotEvents: () => prior.history }
  tracker.seed([{ ...prior.agent, session }])
  assert.equal(JSON.stringify(prior.history), original)
  expectQuiet(tracker)
})

test('seed remains compatible with older agents that have no snapshotEvents method', () => {
  const tracker = new Tracker()
  const session = { id: 'legacy', header: { cwd: '/work/legacy' } }
  tracker.seed([{ id: 'legacy', session, status: 'running' }])
  expectQuiet(tracker)
  assert.equal(tracker.summary().running, 1)
  tracker.sessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: completed }, seq: 1, time: Date.now() })
  expectCounts(tracker, { completed: 1 })
})

for (const phase of ['active', 'paused', 'complete']) {
  test(`seeded ${phase} Goal history does not capture a later independent human turn`, () => {
    const prior = activeGoal()
    if (phase === 'paused') prior.change('pause', 2, phase)
    if (phase === 'complete') prior.change('complete', 2, phase)
    prior.end(1)
    const tracker = new Tracker()
    const c = conversation({ tracker, history: prior.history.slice() })
    tracker.seed([c.agent])
    expectQuiet(tracker)
    c.start(2)
    c.end(2)
    expectCounts(tracker, { completed: 1 })
  })
}

test('seeded completed Goal can resume and notify for its new completion revision', () => {
  const prior = activeGoal()
  prior.change('complete', 2, 'complete')
  prior.end(1)
  const tracker = new Tracker()
  const c = conversation({ tracker, history: prior.history.slice() })
  tracker.seed([c.agent])
  c.start(2)
  c.change('resume', 3, 'active')
  c.end(2)
  expectQuiet(tracker)
  c.start(3, goalSource(3, 1))
  c.change('complete', 4, 'complete')
  c.end(3)
  expectCounts(tracker, { completed: 1 })
})
