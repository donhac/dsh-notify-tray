import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// Mirrors the DSH model's public contract, including clearing all staged edits
// after a successful asynchronous save (the race the autosaver must handle).
class SettingsModel {
  constructor(scope, specs) {
    this.scope = scope
    this.specs = new Map(specs.map(s => [s.field, s]))
    this.staged = new Map()
    this.listeners = new Set()
    this.saving = false
    this.failed = false
  }
  bind(project) {
    return { getSnapshot: project, subscribe: fn => { this.listeners.add(fn); return () => this.listeners.delete(fn) } }
  }
  publish() { for (const fn of this.listeners) fn() }
  shell() {
    return { available: this.scope.ready !== false, writable: this.scope.writable !== false, dirty: this.staged.size > 0, invalid: [...this.staged].some(([key, value]) => value !== null && this.specs.get(key).parse(value) === undefined), saving: this.saving, failed: this.failed }
  }
  field(key) {
    const text = this.staged.has(key) ? this.staged.get(key) ?? this.specs.get(key).format(this.scope.base[key]) : this.specs.get(key).format(this.scope.value[key])
    return { text, invalid: this.specs.get(key).parse(text) === undefined, overridden: this.staged.has(key) }
  }
  actions() {
    return {
      edit: (key, value) => { this.staged.set(key, value); this.failed = false; this.publish() },
      resetField: key => { this.staged.set(key, null); this.failed = false; this.publish() },
    }
  }
  async save() {
    const staged = new Map(this.staged)
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const result = await this.scope.mutate(staged)
      this.failed = !result
      if (result) {
        for (const [key, value] of staged) this.scope.value[key] = value === null ? this.scope.base[key] : this.specs.get(key).parse(value)?.value
        this.staged.clear()
      }
    } catch { this.failed = true }
    finally { this.saving = false; this.publish() }
  }
  dispose() { this.listeners.clear() }
}

function controllers() {
  let factory
  const timers = new Map()
  let seq = 0
  const numberField = field => ({ field, format: n => typeof n === 'number' ? String(n) : '', parse: text => text === '' ? { kind: 'clear' } : Number.isFinite(Number(text)) ? { kind: 'set', value: Number(text) } : undefined })
  const sandbox = {
    window: { __ModuleLoader__: { load: module => { factory = module.factory } } },
    console, fetch: () => new Promise(() => {}),
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id },
    clearTimeout: id => timers.delete(id),
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)
  const client = factory(name => name === 'react' ? { createElement() {} } : { SettingsFormModel: SettingsModel, settingsNumberField: numberField })
  const scope = { value: {}, base: {} }
  client.apply({
    effect() {}, inject() {}, uiWorkspace: {}, sessions: {},
    slots: {}, locale: { bind: () => () => '', register() {} }, configForms: { get: () => scope },
  })
  return { Settings: client.__SettingsController, Updates: client.__UpdateController, timers }
}

const microtasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('autosave batches rapid changes, waits for host confirmation and dismisses only its own toast', async () => {
  const { Settings, timers } = controllers()
  const gate = deferred()
  const writes = []
  const scope = { value: {}, base: {}, mutate: patch => { writes.push(patch); return gate.promise } }
  const card = new Settings(scope)
  const face = card.inject()
  face.edit('sound', 'on')
  face.edit('sound', 'off')
  face.edit('titleStyle', 'count')
  assert.equal(timers.size, 1, 'rapid changes share one debounce timer')
  assert.equal([...timers.values()][0].ms, 500)
  assert.equal(writes.length, 0)
  const done = card.flush()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].get('sound'), 'off')
  assert.equal(writes[0].get('titleStyle'), 'count')
  assert.equal(card.store.getSnapshot().notice, null, 'no success until the host confirms')
  gate.resolve(true)
  await done
  const notice = card.store.getSnapshot().notice
  assert.equal(notice.kind, 'saved')
  face.dismissNotice(notice.id - 1)
  assert.equal(card.store.getSnapshot().notice.id, notice.id)
  face.dismissNotice(notice.id)
  assert.equal(card.store.getSnapshot().notice, null)
  card.dispose()
})

test('edits and resets during an in-flight save survive and are saved in the next batch', async () => {
  const { Settings } = controllers()
  const gate = deferred()
  const writes = []
  const scope = { value: { titleStyle: 'text' }, base: { titleStyle: 'text' }, mutate: patch => { writes.push(patch); return writes.length === 1 ? gate.promise : Promise.resolve(true) } }
  const card = new Settings(scope)
  const face = card.inject()
  face.edit('sound', 'on')
  face.edit('titleStyle', 'count')
  const first = card.flush()
  face.edit('sound', 'off')
  face.resetField('titleStyle')
  face.edit('planProvider', 'kimi')
  gate.resolve(true)
  await first
  assert.equal(card.store.getSnapshot().notice, null, 'no misleading saved toast with newer edits pending')
  assert.equal(card.store.getSnapshot().fields.sound.text, 'off')
  await card.flush()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].get('titleStyle'), null)
  assert.deepEqual(scope.value, { titleStyle: 'text', sound: false, planProvider: 'kimi' })
  assert.equal(card.store.getSnapshot().notice.kind, 'saved')
  card.dispose()
})

test('invalid or read-only settings are never submitted; failures retain edits and allow retry', async () => {
  const { Settings, timers } = controllers()
  let writes = 0
  let succeed = false
  const scope = { value: {}, base: {}, mutate: async () => { writes++; return succeed } }
  const card = new Settings(scope)
  const face = card.inject()
  face.edit('exchangeRate', 'nope')
  assert.equal(await card.flush(), false)
  assert.equal(writes, 0)
  face.edit('exchangeRate', '7.3')
  await card.flush()
  assert.equal(card.store.getSnapshot().notice.kind, 'saveFailed')
  assert.equal(card.store.getSnapshot().fields.exchangeRate.text, '7.3')
  assert.equal(timers.size, 0, 'failed saves do not retry forever')
  succeed = true
  await face.retrySave()
  assert.equal(scope.value.exchangeRate, 7.3)
  assert.equal(card.store.getSnapshot().notice.kind, 'saved')
  scope.writable = false
  face.edit('sound', 'off')
  assert.equal(await card.flush(), false)
  assert.equal(writes, 2)
  card.dispose()
})

test('navigation does not discard queued changes; plugin disposal cancels scheduled work', async () => {
  const { Settings, timers } = controllers()
  let writes = 0
  const card = new Settings({ value: {}, base: {}, mutate: async () => { writes++; return true } })
  card.inject().edit('sound', 'on')
  // The page has no discard-on-unmount wrapper; the controller owns this timer.
  const callback = [...timers.values()][0].fn
  callback()
  await microtasks()
  assert.equal(writes, 1)
  card.inject().edit('sound', 'off')
  card.dispose()
  assert.equal(timers.size, 0)
  assert.equal(await card.flush(), false)
  assert.equal(writes, 1)
})

function manager({ local = false, versions = [], outcome = 'applied' } = {}) {
  const calls = []
  return {
    calls,
    listBundles: async () => ({ ok: true, value: [{ name: 'dsh-notify-tray', version: '0.1.8', updatable: !local, source: local ? 'link:/work/plugin' : '^0.1.8' }] }),
    listVersions: async (...args) => { calls.push(['list', ...args]); return { ok: true, value: { status: 'listed', installed: '0.1.8', registry: 'https://registry.npmjs.org/', versions } } },
    updateBundle: async (...args) => { calls.push(['update', ...args]); return { ok: true, value: { step: 'install', result: { application: outcome } } } },
  }
}
const available = { version: '0.1.9', bundle: true, prerelease: false }

test('updates offer only compatible stable bundles, and use the exact host version and registry on click', async () => {
  const { Updates } = controllers()
  const remote = manager({ versions: [
    { ...available, version: '0.3.0', incompatible: {} },
    { ...available, version: '0.2.0-rc.1', prerelease: true },
    { ...available, version: '0.2.0', deprecated: 'old' },
    { ...available, version: '0.1.10', bundle: false }, available,
  ] })
  let flushed = 0
  const controller = new Updates(() => remote, async () => { flushed++; return true })
  await controller.check()
  assert.equal(controller.snapshot.candidate, '0.1.9')
  assert.equal(remote.calls.filter(c => c[0] === 'update').length, 0, 'checking never installs')
  await controller.update()
  assert.equal(flushed, 1)
  const call = remote.calls.find(c => c[0] === 'update')
  assert.equal(call[1], 'dsh-notify-tray')
  assert.equal(call[2], '0.1.9')
  assert.equal(call[3].registry, 'https://registry.npmjs.org/')
  assert.equal(controller.snapshot.phase, 'updated')
})

test('local installs and missing APIs are explained without querying or replacing a local copy', async () => {
  const { Updates } = controllers()
  const remote = manager({ local: true })
  const controller = new Updates(() => remote, async () => true)
  await controller.check()
  assert.equal(controller.snapshot.phase, 'local')
  await controller.update()
  assert.equal(remote.calls.length, 0)
  const unavailable = new Updates(() => undefined, async () => true)
  await unavailable.check()
  assert.equal(unavailable.snapshot.phase, 'unavailable')
})

test('updates wait for settings, prevent double clicks, and distinguish restart from connection loss', async () => {
  const { Updates } = controllers()
  const remote = manager({ versions: [available], outcome: 'restart-required' })
  const gate = deferred()
  const controller = new Updates(() => remote, () => gate.promise)
  await controller.check()
  const updating = controller.update()
  await controller.update()
  assert.equal(remote.calls.filter(c => c[0] === 'update').length, 0)
  gate.resolve(true)
  await updating
  assert.equal(remote.calls.filter(c => c[0] === 'update').length, 1)
  assert.equal(controller.snapshot.phase, 'restart')
  const failedSave = new Updates(() => remote, async () => false)
  await failedSave.check()
  await failedSave.update()
  assert.equal(failedSave.snapshot.error, 'updateSaveFirst')
  assert.equal(remote.calls.filter(c => c[0] === 'update').length, 1)
  remote.updateBundle = async () => { throw new Error('disconnected') }
  const disconnected = new Updates(() => remote, async () => true)
  await disconnected.check()
  await disconnected.update()
  assert.equal(disconnected.snapshot.phase, 'unknown')
})

test('check failures and rollback outcomes are not reported as a successful update', async () => {
  const { Updates } = controllers()
  const remote = manager({ versions: [available] })
  remote.listVersions = async () => ({ ok: true, value: { status: 'refused', reason: 'network offline' } })
  const controller = new Updates(() => remote, async () => true)
  await controller.check()
  assert.equal(controller.snapshot.phase, 'error')
  assert.equal(controller.snapshot.error, 'network offline')
  for (const [application, expected] of [['applied', 'restored'], ['failed', 'broken']]) {
    const remote = manager({ versions: [available] })
    remote.updateBundle = async () => ({ ok: true, value: { result: { application: 'failed' }, restore: { application } } })
    const controller = new Updates(() => remote, async () => true)
    await controller.check()
    await controller.update()
    assert.equal(controller.snapshot.phase, expected)
  }
})
