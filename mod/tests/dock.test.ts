// Runs under `claude plugin test`: the mod is loaded by Claude Code's own
// engine, and the hooks registered here stand beneath it for the host.
import type { AgentInfo, On, SessionRateLimit, SessionUsage, TurnUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0)
const MINUTE = 60_000
const at = (ms: number) => new Date(T0 + ms).toISOString()

const FIVE_HOUR: SessionRateLimit = { kind: 'five_hour', percentUsed: 92, resetsAt: at(81 * MINUTE) }
const SEVEN_DAY: SessionRateLimit = { kind: 'seven_day', percentUsed: 28, resetsAt: at(146 * 60 * MINUTE) }
/** The week `SEVEN_DAY` ends, as the mod names it: to the hour. */
const THIS_WEEK = at(146 * 60 * MINUTE).slice(0, 13)

const CASH = '現金 · 5-hour quota'
const RESERVE = '備用錢 · Weekly quota'

interface World {
  rateLimits: SessionRateLimit[]
  agents: AgentInfo[]
  /** What the store holds before the session starts. */
  stored?: Record<string, unknown>
  /** Every value the mod stored, in order, each under its key. */
  writes?: [string, unknown][]
  /** Whether the engine has room for a pane nobody asked for. Yes, unless said. */
  isRoomy?: boolean
  /** Every toast the mod raised, in order. */
  toasts?: string[]
  /** What the next response reports of its tokens. */
  usage?: TurnUsage
  /** What is typed in the prompt box. The mod empties it when it hands the task on. */
  prompt?: string
  /** Every agent the mod started, in order: its type and its task. */
  spawned?: { subagentType: string | undefined; prompt: string }[]
  /** Why the engine refuses to start an agent, where it does. */
  refusal?: string
}

function host(on: On, world: World) {
  mock.clock(on, { now: T0 })
  // The store, in memory. Not the kit's own: this one also says what was written.
  const store = new Map(Object.entries(world.stored ?? {}))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    world.writes?.push([e.key, e.value])
    return { value: undefined }
  })
  on('session.usage', () => {
    const value: SessionUsage = { startedAt: T0, context: { window: 200_000 }, rateLimits: world.rateLimits }
    return { value }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: world.agents }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: world.isRoomy === false ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true } }))
  on('ui.panes', () => ({
    value: world.isRoomy === false ? [] : [{ id: 'agentdock', title: 'AgentDock', isShown: true, isFocused: false, isPlaced: true }],
  }))
  on('ui.toast', (_$, e) => {
    world.toasts?.push(e.text)
    return { value: undefined }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('prompt.read', () => ({ value: { text: world.prompt ?? '', cursor: 0 } }))
  on('prompt.fill', (_$, e) => {
    world.prompt = e.text
    return { isFilled: true }
  })
  on('agent.spawn', (_$, e) => {
    if (world.refusal !== undefined) return { deny: world.refusal }
    // Beneath the plugins the call is the Agent tool's own, and spells the type as the tool does.
    const type = (e as { subagent_type?: string }).subagent_type ?? e.subagentType
    world.spawned?.push({ subagentType: type, prompt: e.prompt })
    world.agents = [...world.agents, { id: `a${world.agents.length + 1}`, description: e.description, type, status: 'running' }]
    return { model: 'claude-haiku-5-5', agentId: `a${world.agents.length}` }
  })
  on('agent.offer', () => ({ isOffered: true }))
  // What the engine draws in the band when the mod passes.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['(engine)'] }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: world.usage ?? null }
  })
}

const begin = ($: Engine) => $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })

/** One response of a model, with the tokens the host says it used. */
async function step($: Engine, turnId: string) {
  for await (const chunk of $.turn.step({ turnId, index: 0, model: 'claude-haiku-5-5', messageCount: 1 })) void chunk
}

const used = (model: string, each: number): TurnUsage => ({
  model,
  input_tokens: each,
  output_tokens: each,
  cache_read_input_tokens: each,
  cache_creation_input_tokens: each,
})

const mountBand = ($: Engine, bodyColumns: number, hasSurvey = false) =>
  $.ui.mount({
    plugin: 'agentdock',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false, maxRows: 20, bodyColumns, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })

/** Every text the band above the prompt draws, a row and the runs inside it alike; none where the band is left to the engine. */
async function band($: Engine, bodyColumns = 64): Promise<string[]> {
  const ui = await mountBand($, bodyColumns)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts[0] === '(engine)' ? [] : texts
}

const ROOM = { title: 'AgentDock', isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const mountPane = ($: Engine, bodyColumns: number) =>
  $.ui.mount({ plugin: 'agentdock', surface: 'terminal', component: 'Pane', requestId: 'agentdock', props: { ...ROOM, bodyColumns } })

/** Every text the pane draws, a row and the runs inside it alike. */
async function pane($: Engine, bodyColumns = 40): Promise<string[]> {
  const ui = await mountPane($, bodyColumns)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts
}

/** The moving sign's grid in the pane, as `[columns, rows]`; null where none is drawn. */
async function sign($: Engine, bodyColumns = 40): Promise<[number, number] | null> {
  const ui = await mountPane($, bodyColumns)
  const [raster] = await ui.findAll({ type: 'Raster' })
  await ui.unmount()
  return raster === undefined ? null : [Number(raster.props.columns), Number(raster.props.rows)]
}

/** The bars among `texts`, each whole: a row of lamps, lit then dark, `columns` long. */
const bars = (texts: readonly string[], columns: number) => texts.filter(text => /^⣿*⣀*$/.test(text) && text.length === columns)

const dock = ($: Engine, args: string) =>
  $.command.run({ command: 'dock', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

test('Account Status is at the top of the pane: each window under its own name, what is left of it, and the time to its reset', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR, SEVEN_DAY], agents: [] })
  await begin($)
  const texts = await pane($)
  expect(texts).toContain(`${CASH} 8% · 1h 21m`)
  expect(texts).toContain(`${RESERVE} 72% · 6d 2h`)
  expect(texts.indexOf('ACCOUNT STATUS')).toBeLessThan(texts.indexOf('AGENTS'))
  expect(await band($)).toEqual([])
})

test('each window has a bar of its own, as long as what is left', async ($, on) => {
  host(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 50 }, { kind: 'seven_day', percentUsed: 75 }], agents: [] })
  await begin($)
  // A frame takes two of the pane's 40 columns.
  expect(bars(await pane($, 40), 38)).toEqual(['⣿'.repeat(19) + '⣀'.repeat(19), '⣿'.repeat(10) + '⣀'.repeat(28)])
})

test('in a pane too narrow for the full name of a window beside its figures, the short name is drawn', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR, SEVEN_DAY], agents: [] })
  await begin($)
  const texts = await pane($, 28)
  expect(texts).toContain('現金 5H 8% · 1h 21m')
  expect(texts).toContain('備用錢 WEEK 72% · 6d 2h')
})

test('a session with no reading of its own shows the last one stored, and says how old it is', async ($, on) => {
  host(on, { rateLimits: [], agents: [], stored: { reading: { limits: [FIVE_HOUR], at: T0 - 30 * MINUTE } } })
  await begin($)
  const texts = await pane($)
  expect(texts.some(text => text.startsWith(`${CASH} 8%`))).toBe(true)
  expect(texts).toContain('READ 30M AGO')
})

test('with no reading at all the status says so', async ($, on) => {
  host(on, { rateLimits: [], agents: [] })
  await begin($)
  expect(await pane($)).toContain('NO USAGE READING YET')
})

test('where the pane is not placed by itself, a toast says how to open it, and Account Status is drawn above the prompt', async ($, on) => {
  const narrow: World = { rateLimits: [FIVE_HOUR], agents: [], isRoomy: false, toasts: [] }
  host(on, narrow)
  await begin($)
  expect(narrow.toasts).toEqual(['AgentDock: type /dock to open the pane'])
  expect((await band($)).some(text => text.startsWith(`${CASH} 8%`))).toBe(true)
})

test('where the pane is placed by itself, nothing is said', async ($, on) => {
  const wide: World = { rateLimits: [], agents: [], toasts: [] }
  host(on, wide)
  await begin($)
  expect(wide.toasts).toEqual([])
})

test('/dock status moves Account Status to above the prompt and back, and the place is kept', async ($, on) => {
  const world: World = { rateLimits: [FIVE_HOUR], agents: [], writes: [] }
  host(on, world)
  await begin($)
  await dock($, 'status')
  expect((await band($)).some(text => text.startsWith(`${CASH} 8%`))).toBe(true)
  expect(await pane($)).not.toContain('ACCOUNT STATUS')
  expect(await pane($)).toContain('AGENTS')
  expect(world.writes?.at(-1)).toEqual(['statusAt', 'band'])
  await dock($, 'status')
  expect(await band($)).toEqual([])
  expect(await pane($)).toContain('ACCOUNT STATUS')
})

test('a session started with Account Status moved above the prompt draws it there', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR], agents: [], stored: { statusAt: 'band' } })
  await begin($)
  expect(await band($)).toContain('ACCOUNT STATUS')
  expect(await pane($)).not.toContain('ACCOUNT STATUS')
})

test('a reading that arrives with a turn replaces the one shown, and is stored', async ($, on) => {
  const world: World = { rateLimits: [FIVE_HOUR], agents: [], writes: [] }
  host(on, world)
  await begin($)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 95 }], changed: ['rateLimits'] })
  expect(await pane($)).toContain(`${CASH} 5%`)
  expect(world.writes?.at(-1)).toEqual(['reading', { limits: [{ kind: 'five_hour', percentUsed: 95 }], at: T0 }])
})

test('a measure with no window does not wipe the reading', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR], agents: [] })
  await begin($)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'] })
  expect((await pane($)).some(text => text.startsWith(`${CASH} 8%`))).toBe(true)
})

test('a survey in the band is left alone', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR], agents: [], stored: { statusAt: 'band' } })
  await begin($)
  const ui = await mountBand($, 64, true)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  expect(texts).toEqual(['(engine)'])
})

test('before any response the week has no tokens, and the status says so', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR, SEVEN_DAY], agents: [] })
  await begin($)
  expect(await pane($)).toContain('NONE COUNTED YET')
})

test('each response adds its tokens to its model for the week, on top of what other sessions counted', async ($, on) => {
  const world: World = {
    rateLimits: [FIVE_HOUR, SEVEN_DAY],
    agents: [],
    stored: { week: { endsAt: THIS_WEEK, tokens: { 'claude-opus-5-5': 2_000_000 } } },
    writes: [],
    usage: used('claude-haiku-5-5', 250),
  }
  host(on, world)
  await begin($)
  await step($, 't1')
  await step($, 't2')
  const texts = await pane($)
  expect(texts.some(text => /OPUS-5-5\s+2\.00M$/.test(text))).toBe(true)
  expect(texts.some(text => /HAIKU-5-5\s+2\.0K$/.test(text))).toBe(true)
  expect(world.writes?.at(-1)).toEqual(['week', { endsAt: THIS_WEEK, tokens: { 'claude-opus-5-5': 2_000_000, 'claude-haiku-5-5': 2_000 } }])
})

test('a count from a week that has ended is not carried into the next', async ($, on) => {
  const world: World = {
    rateLimits: [FIVE_HOUR, SEVEN_DAY],
    agents: [],
    stored: { week: { endsAt: '2026-10-03T14', tokens: { 'claude-opus-5-5': 2_000_000 } } },
    usage: used('claude-haiku-5-5', 250),
  }
  host(on, world)
  await begin($)
  expect(await pane($)).toContain('NONE COUNTED YET')
  await step($, 't1')
  const texts = await pane($)
  expect(texts.some(text => text.includes('OPUS'))).toBe(false)
  expect(texts.some(text => /HAIKU-5-5\s+1\.0K$/.test(text))).toBe(true)
})

test('the moving sign is drawn over Account Status, as wide as its frame allows', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR, SEVEN_DAY], agents: [] })
  await begin($)
  expect(await sign($, 40)).toEqual([38, 6])
  expect(await sign($, 28)).toEqual([26, 6])
})

test('/dock ufo switches the moving sign off and on, and the choice is kept', async ($, on) => {
  const world: World = { rateLimits: [FIVE_HOUR, SEVEN_DAY], agents: [], writes: [] }
  host(on, world)
  await begin($)
  await dock($, 'ufo')
  expect(await sign($)).toBe(null)
  expect(world.writes?.at(-1)).toEqual(['ufo', false])
  expect((await pane($)).some(text => text.startsWith(CASH))).toBe(true)
  await dock($, 'ufo')
  expect(await sign($)).toEqual([38, 6])
})

test('a session started with the moving sign switched off draws none', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR, SEVEN_DAY], agents: [], stored: { ufo: false } })
  await begin($)
  expect(await sign($)).toBe(null)
})

test('agent types are listed as they are offered, each once, and every one stays offered', async ($, on) => {
  host(on, { rateLimits: [], agents: [] })
  await begin($)
  const provider = { plugin: 'engine', tier: 'core' } as const
  const explore = await $.agent.offer({ agent: 'Explore', description: 'Searches', source: 'built-in', provider })
  await $.agent.offer({ agent: 'Plan', description: 'Plans', source: 'built-in', provider })
  await $.agent.offer({ agent: 'Explore', description: 'Searches', source: 'built-in', provider })
  expect(explore.isOffered).toBe(true)
  const texts = await pane($)
  expect(texts.filter(text => text === 'Explore').length).toBe(1)
  expect(texts).toContain('Plan')
})

test('the agents at work are listed with what each is doing', async ($, on) => {
  const world: World = { rateLimits: [], agents: [] }
  host(on, world)
  await begin($)
  expect(await pane($)).toContain('NONE AT WORK')
  world.agents = [{ id: 'a1', description: 'find the parser', type: 'Explore', status: 'running' }]
  await $.turn.complete({ turnId: 't1', reason: 'answer', durationMs: 10, answer: 'done', isAborted: false })
  expect((await pane($)).some(text => text.includes('Explore running'))).toBe(true)
})

const BUILT_IN = { plugin: 'engine', tier: 'core' } as const

/** A session in which Explore is on offer, and the pane with its buttons. */
async function offering($: Engine) {
  await begin($)
  await $.agent.offer({ agent: 'Explore', description: 'Searches', source: 'built-in', provider: BUILT_IN })
  return mountPane($, 40)
}

test('pressing an agent type hands it the task in the prompt box at once, and empties the box', async ($, on) => {
  const world: World = { rateLimits: [], agents: [], prompt: '  find where the parser reads its input and say how  ', spawned: [], toasts: [] }
  host(on, world)
  const ui = await offering($)
  await ui.press({ key: 'send:Explore' })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  expect(world.spawned).toEqual([{ subagentType: 'Explore', prompt: 'find where the parser reads its input and say how' }])
  expect(world.prompt).toBe('')
  expect(world.toasts).toEqual(['AgentDock: sent to Explore'])
  expect(texts.some(text => text.includes('Explore running'))).toBe(true)
})

test('with nothing typed, pressing an agent type starts none and says what to do', async ($, on) => {
  const world: World = { rateLimits: [], agents: [], prompt: '   ', spawned: [], toasts: [] }
  host(on, world)
  const ui = await offering($)
  await ui.press({ key: 'send:Explore' })
  await ui.unmount()
  expect(world.spawned).toEqual([])
  expect(world.toasts).toEqual(['AgentDock: type the task in the prompt, then press an agent'])
})

test('where the agent is refused, the task stays in the box and the reason is said', async ($, on) => {
  const world: World = { rateLimits: [], agents: [], prompt: 'find the parser', spawned: [], toasts: [], refusal: 'not allowed here' }
  host(on, world)
  const ui = await offering($)
  await ui.press({ key: 'send:Explore' })
  await ui.unmount()
  expect(world.prompt).toBe('find the parser')
  expect(world.toasts).toEqual(['AgentDock: Explore was not started: not allowed here'])
})

test('every type on offer can be pressed, however many there are', async ($, on) => {
  host(on, { rateLimits: [FIVE_HOUR, SEVEN_DAY], agents: [] })
  await begin($)
  for (let index = 0; index < 30; index++) await $.agent.offer({ agent: `type-${index}`, description: 'x', source: 'plugin', provider: BUILT_IN })
  const texts = await pane($)
  expect(texts.filter(text => text.startsWith('type-')).length).toBe(30)
})

test('the types Claude Code has of its own are listed before the installed ones', async ($, on) => {
  host(on, { rateLimits: [], agents: [] })
  await begin($)
  await $.agent.offer({ agent: 'audio:engineer', description: 'x', source: 'plugin', provider: BUILT_IN })
  await $.agent.offer({ agent: 'Explore', description: 'x', source: 'built-in', provider: BUILT_IN })
  await $.agent.offer({ agent: 'qa-reviewer', description: 'x', source: 'projectSettings', provider: BUILT_IN })
  await $.agent.offer({ agent: 'Plan', description: 'x', source: 'built-in', provider: BUILT_IN })
  const names = (await pane($)).filter(text => ['audio:engineer', 'Explore', 'qa-reviewer', 'Plan'].includes(text))
  expect(names).toEqual(['Explore', 'Plan', 'audio:engineer', 'qa-reviewer'])
})
