// The two rules in the conversation. Runs under `claude plugin test`: the mod
// is loaded by Claude Code's own engine, and the hooks registered here stand
// beneath it for the host.
import type { On, SessionMessage, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0)

interface World {
  /** What the store holds before the session starts. */
  stored?: Record<string, unknown>
  /** Every value the mod stored, in order, each under its key. */
  writes?: [string, unknown][]
  /** Whether the next response of the model calls a tool. */
  callsTool?: boolean
  /** The conversation as it was stored before this load. */
  messages?: SessionMessage[]
}

function host(on: On, world: World = {}) {
  mock.clock(on, { now: T0 })
  const store = new Map(Object.entries(world.stored ?? {}))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    world.writes?.push([e.key, e.value])
    return { value: undefined }
  })
  on('session.usage', () => {
    const value: SessionUsage = { startedAt: T0, context: { window: 200_000 }, rateLimits: [] }
    return { value }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: world.messages ?? [] }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  // What the engine draws of a row when the mod adds nothing to it.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text', props: {}, children: ['(engine)'] }) as never)
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Text', props: {}, children: ['(engine)'] }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('turn.step', async function* (_$, e) {
    const toolUses = world.callsTool ? [{ id: 'tool-1', name: 'Read', input: {} }] : []
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: toolUses as never, stopReason: world.callsTool ? 'tool_use' : 'end_turn', usage: null }
  })
}

const begin = ($: Engine) => $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })

/** One response of the model: the main loop's, or a subagent's. */
async function step($: Engine, turnId: string, agentId?: string) {
  for await (const chunk of $.turn.step({ turnId, index: 0, model: 'claude-haiku-5-5', messageCount: 1, ...(agentId !== undefined && { agentId }) })) void chunk
}

const TEXT = (text = 'Done.') => ({ type: 'text', text })
const TOOL = { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }

/** Stores a row as a session does, a block a row, under the id the transcript then draws it by. */
const wrote = ($: Engine, uuid: string, block: Record<string, unknown>, agentId?: string) =>
  $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [block as never] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-haiku-5-5' },
    uuid,
    ...(agentId !== undefined && { agentId }),
  })

/** A prompt's row as it is drawn: its texts from the top, each with its colour. */
async function promptRow($: Engine, origin: Record<string, unknown> = { kind: 'composer' }, columns = 100) {
  const ui = await $.ui.mount({
    plugin: 'agentdock',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'prompt-1',
    viewport: { columns, rows: 40 },
    props: { text: 'Fix the login page', origin: origin as never, isExpanded: true },
  })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map(one => [one.text, one.props.color])
}

/** A row of the model's text as it is drawn: its texts from the top, each with its colour. */
async function replyRow($: Engine, id = 'r1', text = 'Done.', isSummary = false) {
  const ui = await $.ui.mount({
    plugin: 'agentdock',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: id,
    viewport: { columns: 100, rows: 40 },
    props: { text, isFirstOfReply: true, ...(isSummary && { isSummary: true as const }) },
  })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map(one => [one.text, one.props.color])
}

const ENGINE = ['(engine)', undefined]
const EXCHANGE = (columns = 100) => ['⠂'.repeat(columns), '#4a3300']
const ANSWER = ['⠶'.repeat(100), '#ffb000']

const dock = ($: Engine, args: string) =>
  $.command.run({ command: 'dock', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

test('a prompt the person typed has a dark rule above it, as wide as the transcript', async ($, on) => {
  host(on)
  await begin($)
  expect(await promptRow($)).toEqual([EXCHANGE(), ENGINE])
  expect(await promptRow($, { kind: 'composer' }, 72)).toEqual([EXCHANGE(72), ENGINE])
})

test('a row that is not a typed prompt has no rule', async ($, on) => {
  host(on)
  await begin($)
  expect(await promptRow($, { kind: 'task-notification' })).toEqual([ENGINE])
})

test('the closing answer has a lit rule above it, once its response has ended', async ($, on) => {
  host(on)
  await begin($)
  await wrote($, 'r1', TEXT('It says alpha.'))
  // The row is first drawn while its response is still open: nothing says yet that no tool call follows.
  expect(await replyRow($)).toEqual([ENGINE])
  await step($, 't1')
  expect(await replyRow($)).toEqual([ANSWER, ENGINE])
})

test('what the model writes on its way to a tool call has no rule; the answer after the work has', async ($, on) => {
  const world: World = { callsTool: true }
  host(on, world)
  await begin($)
  await wrote($, 'r1', TEXT('Let me read the file.'))
  await wrote($, 'r2', TOOL)
  await step($, 't1')
  expect(await replyRow($, 'r1')).toEqual([ENGINE])
  world.callsTool = false
  await wrote($, 'r3', TEXT('It says alpha.'))
  await step($, 't1')
  expect(await replyRow($, 'r1')).toEqual([ENGINE])
  expect(await replyRow($, 'r3')).toEqual([ANSWER, ENGINE])
})

test('a turn cut short has its rule above what was written', async ($, on) => {
  host(on)
  await begin($)
  await wrote($, 'r1', TEXT('Half an ans'))
  await $.turn.complete({ turnId: 't1', reason: 'aborted', durationMs: 10, answer: '', isAborted: true })
  expect(await replyRow($)).toEqual([ANSWER, ENGINE])
})

test('a subagent has no rule of its own, and does not close the main reply', async ($, on) => {
  host(on)
  await begin($)
  await wrote($, 'r1', TEXT('Working on it.'))
  await wrote($, 's1', TEXT('Found it.'), 'agent-1')
  await step($, 't9', 'agent-1')
  expect(await replyRow($, 's1')).toEqual([ENGINE])
  expect(await replyRow($, 'r1')).toEqual([ENGINE])
})

test('a summary row has no rule', async ($, on) => {
  host(on)
  await begin($)
  await wrote($, 'r1', TEXT())
  await step($, 't1')
  expect(await replyRow($, 'r1', 'Done.', true)).toEqual([ENGINE])
})

test('a conversation stored before this load has the rules of its answers, each known by its text', async ($, on) => {
  host(on, {
    messages: [
      { role: 'user', text: 'What does a.txt say?', toolUses: [] },
      // A stored row is a block: the text the model wrote, then its tool call.
      { role: 'assistant', text: 'Let me read the file.', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ id: 'tool-1', name: 'Read', input: {} }] } as never,
      { role: 'user', text: '', toolUses: [], toolResults: [{ id: 'tool-1' }] } as never,
      { role: 'assistant', text: 'It says alpha.', toolUses: [] },
    ],
  })
  await begin($)
  expect(await replyRow($, 'old-2', 'It says alpha.')).toEqual([ANSWER, ENGINE])
  expect(await replyRow($, 'old-1', 'Let me read the file.')).toEqual([ENGINE])
})

test('/dock rules takes both rules away and brings them back, and the choice is kept', async ($, on) => {
  const world: World = { writes: [] }
  host(on, world)
  await begin($)
  await wrote($, 'r1', TEXT())
  await step($, 't1')
  await dock($, 'rules')
  expect(await promptRow($)).toEqual([ENGINE])
  expect(await replyRow($)).toEqual([ENGINE])
  expect(world.writes?.at(-1)).toEqual(['rules', false])
  await dock($, 'rules')
  expect(await promptRow($)).toEqual([EXCHANGE(), ENGINE])
  expect(await replyRow($)).toEqual([ANSWER, ENGINE])
})

test('a session started with the rules switched off draws none', async ($, on) => {
  host(on, { stored: { rules: false } })
  await begin($)
  expect(await promptRow($)).toEqual([ENGINE])
})
