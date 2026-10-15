// AgentDock: Account Status and Agents, drawn inside Claude Code as a
// dot-matrix sign of the kind the MTR ran news on in the early 2000s: lamps
// of red, green and amber on black, a line of text that runs right to left,
// and a small animation. It draws what the session itself reports (the
// account's usage windows, the tokens each model was sent and sent back, the
// agent types on offer, the agents at work) and asks the model for nothing.
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { DockAgent, DockAgentType, DockLimit, DockReading, DockWeek } from '../types'

const PANE = 'agentdock'
const TITLE = 'AgentDock'
/** The width asked for: about a quarter of a wide terminal. */
const PANE_COLUMNS = 42
/** Where the last reading is kept across sessions: a new session has none of its own until its first response. */
const STORED_READING = 'reading'
/** Where the week's tokens a model are kept, for every session to add to. */
const STORED_WEEK = 'week'
/** Whether the sign's moving part is drawn. Kept across sessions; on unless switched off. */
const STORED_UFO = 'ufo'
/** Where Account Status is drawn. Kept across sessions; at the top unless moved. */
const STORED_PLACE = 'statusAt'
/** Whether the two rules are drawn in the conversation. Kept across sessions; on unless switched off. */
const STORED_RULES = 'rules'

const reading = atom({ plugin: 'agentdock', key: 'reading' } as const, null)
const available = atom({ plugin: 'agentdock', key: 'available' } as const, [])
const active = atom({ plugin: 'agentdock', key: 'active' } as const, [])
const week = atom({ plugin: 'agentdock', key: 'week' } as const, null)
const isUfoOn = atom({ plugin: 'agentdock', key: 'isUfoOn' } as const, true)
const statusAt = atom({ plugin: 'agentdock', key: 'statusAt' } as const, 'top')
const areRulesOn = atom({ plugin: 'agentdock', key: 'areRulesOn' } as const, true)

/** The owner's names for the two windows: what is spent first, and what is behind it. */
const WINDOW_NAMES: Record<string, string> = { five_hour: '現金 · 5-hour quota', seven_day: '備用錢 · Weekly quota' }
/** The same two where the full name would not fit beside its figures. */
const WINDOW_SHORT_NAMES: Record<string, string> = { five_hour: '現金 5H', seven_day: '備用錢 WEEK' }
/** The same two as the running line spells them: its lamps draw capitals and figures only. */
const WINDOW_CALLS: Record<string, string> = { five_hour: 'CASH', seven_day: 'RESERVE' }

// The three lamps such a sign had, and the board behind them.
const RED = 0xff3b30
const GREEN = 0x3ddc55
const AMBER = 0xffb000
const BOARD = 0x000000
const LAMP_COLORS = { error: '#ff3b30', warning: '#ffb000', success: '#3ddc55' } as const
const AMBER_TEXT = '#ffb000'
const UNLIT_TEXT = '#4a3300'
/** The agents' half of the pane is in the sign's green, so that the two halves are told apart at a glance. */
const GREEN_TEXT = '#3ddc55'
const UNLIT_GREEN_TEXT = '#1d5a28'
/** The columns a half's frame takes of the pane: a line down each side. */
const FRAME_COLUMNS = 2
const BOARD_TEXT = '#000000'

/** The widest the sign is drawn where it has the band to itself. */
const SIGN_MAX_COLUMNS = 60
/** The sign's moving part: two rows of running text over four of sky and field. A cell is two lamps by four. */
const LINE_ROWS = 2
const SCENE_ROWS = 4
const SIGN_ROWS = LINE_ROWS + SCENE_ROWS
const FRAME_MS = 100

/** A reading as it was stored, or null for anything that is not one. */
function asReading(value: unknown): DockReading | null {
  if (typeof value !== 'object' || value === null) return null
  const { limits, at } = value as { limits?: unknown; at?: unknown }
  if (typeof at !== 'number' || !Array.isArray(limits)) return null
  const kept: DockLimit[] = []
  for (const one of limits) {
    if (typeof one !== 'object' || one === null) continue
    const { kind, percentUsed, resetsAt } = one as { kind?: unknown; percentUsed?: unknown; resetsAt?: unknown }
    if (typeof kind !== 'string' || typeof percentUsed !== 'number') continue
    kept.push(typeof resetsAt === 'string' ? { kind, percentUsed, resetsAt } : { kind, percentUsed })
  }
  return { limits: kept, at }
}

/** A week's tokens as they were stored, or null for anything that is not one. */
function asWeek(value: unknown): DockWeek | null {
  if (typeof value !== 'object' || value === null) return null
  const { endsAt, tokens } = value as { endsAt?: unknown; tokens?: unknown }
  if ((endsAt !== null && typeof endsAt !== 'string') || typeof tokens !== 'object' || tokens === null) return null
  const kept: Record<string, number> = {}
  for (const [model, sum] of Object.entries(tokens)) if (typeof sum === 'number') kept[model] = sum
  return { endsAt, tokens: kept }
}

/**
 * When the account's week ends, to the hour, as the weekly window says; null
 * while no reading has one. It names the week the tokens are counted in.
 */
function weekEnd(account: DockReading | null): string | null {
  const resetsAt = account?.limits.find(one => one.kind === 'seven_day')?.resetsAt
  return resetsAt === undefined ? null : resetsAt.slice(0, 13)
}

/**
 * The week's count as it stands for the week now running: the stored one
 * while it is of this week or the week is not known, and an empty one once
 * the weekly window has moved on.
 */
function currentWeek(stored: DockWeek | null, endsAt: string | null): DockWeek {
  if (stored === null) return { endsAt, tokens: {} }
  if (endsAt === null || stored.endsAt === null || stored.endsAt === endsAt) return { endsAt: endsAt ?? stored.endsAt, tokens: stored.tokens }
  return { endsAt, tokens: {} }
}

/** Takes a reading the session reported. One with no window says nothing, and is not kept over one that did. */
async function keepReading($: EngineInterface, limits: readonly DockLimit[]) {
  if (limits.length === 0) return
  const next: DockReading = { limits: limits.map(one => ({ ...one })), at: await $.clock.now() }
  await update($, reading, () => next)
  await $.store.set(STORED_READING, next)
}

/**
 * Adds one response's tokens to the week's count for its model. The store is
 * read again first: other sessions add to the same count. Two that add in the
 * same instant can still lose one of the two; the count is not a ledger.
 */
async function addTokens($: EngineInterface, model: string, sum: number) {
  const now = currentWeek(asWeek(await $.store.get(STORED_WEEK)), weekEnd(await read($, reading)))
  const next: DockWeek = { endsAt: now.endsAt, tokens: { ...now.tokens, [model]: (now.tokens[model] ?? 0) + sum } }
  await $.store.set(STORED_WEEK, next)
  await update($, week, () => next)
}

/** How much of a task is kept as the few words an agent is listed by. */
const BRIEF_WORDS = 6

/**
 * Hands the task in the prompt box to an agent of the type pressed, at once,
 * and empties the box. The person chose the agent; the model is not asked
 * whether to delegate. With nothing typed there is nothing to hand over, and
 * a toast says what to do.
 */
async function dispatch($: EngineInterface, agent: string) {
  const task = (await $.prompt.read()).text.trim()
  if (task === '') {
    $.ui.toast('AgentDock: type the task in the prompt, then press an agent')
    return
  }
  const started = await $.agent.spawn({ prompt: task, subagentType: agent, description: task.split(/\s+/).slice(0, BRIEF_WORDS).join(' ') })
  if (started.deny !== undefined) {
    $.ui.toast(`AgentDock: ${agent} was not started: ${started.deny}`)
    return
  }
  await $.prompt.fill({ text: '', mode: 'replace' })
  await refreshActive($)
  $.ui.toast(`AgentDock: sent to ${agent}`)
}

async function refreshActive($: EngineInterface) {
  const agents = await $.agent.list()
  const next: DockAgent[] = agents.map(one => ({ id: one.id, type: one.type, description: one.description, status: one.status }))
  await update($, active, () => next)
}

/** What is left of a window, 0 to 100. */
const left = (limit: DockLimit): number => Math.round(Math.max(0, Math.min(100, 100 - limit.percentUsed)))

const leftLamp = (percent: number): keyof typeof LAMP_COLORS => (percent <= 15 ? 'error' : percent <= 40 ? 'warning' : 'success')

function span(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function count(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)}M`
}

/** `claude-haiku-4-5-20251001` as `haiku-4-5`. */
const modelName = (model: string): string => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

/** A lamp a model family. The sign has three, so two families share one. */
function modelLamp(model: string): string {
  if (model.includes('opus') || model.includes('fable')) return LAMP_COLORS.error
  if (model.includes('haiku')) return LAMP_COLORS.success
  return LAMP_COLORS.warning
}

/** The cells a text takes in a terminal: two for a character of the CJK ranges, one for any other. */
const cells = (text: string): number => [...text].reduce((sum, mark) => sum + ((mark.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0)

const cut = (text: string, room: number): string => (text.length <= room ? text : `${text.slice(0, Math.max(0, room - 1))}…`)

const STATUS_LAMPS: Record<string, string> = {
  running: LAMP_COLORS.success,
  pending: LAMP_COLORS.warning,
  waiting: LAMP_COLORS.warning,
  idle: UNLIT_TEXT,
  completed: UNLIT_TEXT,
  failed: LAMP_COLORS.error,
  killed: LAMP_COLORS.error,
}

/**
 * What the running line says, in the capitals and figures its lamps can
 * draw: each window, each model's week, and how many agents are at work.
 */
function runningLine(account: DockReading | null, perModel: readonly [string, number][], agents: readonly DockAgent[], now: number): string {
  const parts: string[] = []
  for (const limit of account?.limits ?? []) {
    const resets = limit.resetsAt === undefined ? '' : ` RESET ${span(Date.parse(limit.resetsAt) - now)}`
    parts.push(`${WINDOW_CALLS[limit.kind] ?? limit.kind} ${left(limit)}% LEFT${resets}`)
  }
  for (const [model, sum] of perModel) parts.push(`${modelName(model)} ${count(sum)} TOK`)
  const working = agents.filter(one => one.status === 'running').length
  if (working > 0) parts.push(`${working} AGENT${working === 1 ? '' : 'S'} AT WORK`)
  if (parts.length === 0) parts.push('AGENTDOCK')
  return `${parts.join('  *  ')}  *  `.toUpperCase()
}

// The lamps. A glyph is five lamps wide and seven tall, a row a number, its
// left lamp the highest of five bits.
const GLYPHS: Record<string, readonly number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  ':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  '/': [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x00],
  '*': [0x00, 0x04, 0x15, 0x0e, 0x15, 0x04, 0x00],
}
/** A glyph and the dark lamp after it. */
const GLYPH_PITCH = 6

const UFO = ['...ggggg...', '.rrrrrrrrr.', 'rararararar', '..rrrrrrr..']
const COW = ['.aaaaaa.', 'a.aa.aaa', 'aaaaaaaa', '.a....a.']
const COW_STEP = ['.aaaaaa.', 'a.aa.aaa', 'aaaaaaaa', '..a..a..']
const COW_WIDTH = 8
const SPRITE_LAMPS: Record<string, number> = { r: RED, g: GREEN, a: AMBER }
/** Bit 24 alone: the terminal's own colour, per RasterProps. */
const DEFAULT_COLOR = 0x01000000
/** Which bit of a braille cell each of its eight dots is, by column then row. */
const DOT_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const

/**
 * The sign at one frame, as a Raster's cells: `columns` cells wide, the
 * running line over the scene. A cell is a braille character, so each lamp is
 * a dot of it and a cell has one colour: where two lamps of different colours
 * fall in one cell, the one lit last has it.
 */
function sign(frame: number, columns: number, line: string): string {
  const width = columns * 2
  const height = SIGN_ROWS * 4
  const lamps = new Uint32Array(width * height)
  const light = (x: number, y: number, color: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) lamps[y * width + x] = color
  }

  // The line runs right to left, one lamp a frame, and follows itself round.
  const lineWidth = Math.max(1, line.length * GLYPH_PITCH)
  for (let x0 = -(((frame % lineWidth) + lineWidth) % lineWidth); x0 < width; x0 += lineWidth) {
    ;[...line].forEach((mark, index) => {
      const glyph = GLYPHS[mark]
      const x = x0 + index * GLYPH_PITCH
      if (glyph === undefined || x <= -GLYPH_PITCH || x >= width) return
      glyph.forEach((bits, row) => {
        for (let column = 0; column < 5; column++) if (bits & (0x10 >> column)) light(x + column, row, AMBER)
      })
    })
  }

  // The scene, under the line: a UFO lifts a cow, carries it across, sets it
  // down and flies back empty while the cow walks home.
  const top = LINE_ROWS * 4
  const draw = (sprite: readonly string[], x: number, y: number) =>
    sprite.forEach((row, dy) =>
      [...row].forEach((mark, dx) => {
        const lamp = SPRITE_LAMPS[mark]
        if (lamp !== undefined) light(x + dx, top + y + dy, lamp)
      }),
    )
  const sceneHeight = SCENE_ROWS * 4
  const ground = sceneHeight - 1
  const cowTop = ground - COW.length
  const lifted = UFO.length
  const leftX = 2
  const rightX = Math.max(leftX + 4, width - COW_WIDTH - 3)
  const rise = Math.max(1, cowTop - lifted)
  const flight = rightX - leftX
  // The four acts, in frames: lift, carry, set down, and the way back. On the way back the two part:
  // the empty ship flies home at three times the cow's pace and waits there, and the cow walks.
  const liftFrames = rise * 2 + 6
  const backFrames = flight + 8
  const total = liftFrames + flight + liftFrames + backFrames
  const at = ((frame % total) + total) % total

  let ufoX = leftX - 1
  let cowX = leftX
  let cowY = cowTop
  let hasBeam = false
  let isCowShown = true
  let isWalking = false
  if (at < liftFrames) {
    hasBeam = true
    cowY = cowTop - Math.min(rise, Math.floor(at / 2))
    isCowShown = cowY > lifted
  } else if (at < liftFrames + flight) {
    ufoX = leftX - 1 + (at - liftFrames)
    isCowShown = false
  } else if (at < liftFrames + flight + liftFrames) {
    const down = at - liftFrames - flight
    ufoX = rightX - 1
    cowX = rightX
    hasBeam = true
    cowY = lifted + Math.min(rise, Math.floor(down / 2))
    isCowShown = cowY > lifted
  } else {
    const since = at - liftFrames - flight - liftFrames
    const walked = Math.min(flight, since)
    ufoX = rightX - 1 - Math.min(flight, since * 3)
    cowX = rightX - walked
    isWalking = walked < flight && at % 4 < 2
  }

  for (let x = 0; x < width; x++) light(x, top + ground, GREEN)
  // The beam is every other lamp, so that the cow in it can still be made out.
  if (hasBeam) for (let y = UFO.length; y < ground; y++) for (let x = 3; x < 8; x++) if ((x + y + frame) % 2 === 0) light(ufoX + x, top + y, GREEN)
  if (isCowShown) draw(isWalking ? COW_STEP : COW, cowX, cowY)
  draw(UFO, ufoX, 0)

  const cells = new Uint32Array(columns * SIGN_ROWS * 3)
  for (let row = 0; row < SIGN_ROWS; row++) {
    for (let column = 0; column < columns; column++) {
      let bits = 0
      let color = DEFAULT_COLOR
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          const lamp = lamps[(row * 4 + dy) * width + column * 2 + dx] ?? 0
          if (lamp === 0) continue
          bits |= DOT_BITS[dx]?.[dy] ?? 0
          color = lamp
        }
      }
      const cell = (row * columns + column) * 3
      cells[cell] = 0x2800 + bits
      cells[cell + 1] = color
      cells[cell + 2] = BOARD
    }
  }
  return base64(new Uint8Array(cells.buffer))
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64, written out: the environment's own encoder is not in the types a mod is checked against. */
function base64(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0
    const b = bytes[at + 1] ?? 0
    const c = bytes[at + 2] ?? 0
    text += BASE64[a >> 2]
    text += BASE64[((a & 3) << 4) | (b >> 4)]
    text += at + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '='
    text += at + 2 < bytes.length ? BASE64[c & 63] : '='
  }
  return text
}

type TerminalElements = Elements['terminal']

/** Account Status as it is drawn, wherever it is drawn: the sign, then each window, then the week's tokens. */
interface Status {
  account: DockReading | null
  perModel: [string, number][]
  now: number
  columns: number
  /** The sign's cells for this frame, or null where the sign is left out. */
  cells: string | null
}

function statusTree(Box: TerminalElements['Box'], Text: TerminalElements['Text'], Raster: TerminalElements['Raster'] | null, status: Status) {
  const { account, perModel, now, columns } = status
  // A lit lamp and a dark one, as text: the bars are lamps of the same sign.
  const lit = '⣿'
  const dark = '⣀'

  return (
    <Box flexDirection="column" width={columns + FRAME_COLUMNS} backgroundColor={BOARD_TEXT} borderStyle="single" borderColor={AMBER_TEXT}>
      {Raster !== null && status.cells !== null && <Raster key="sign" columns={columns} rows={SIGN_ROWS} cells={status.cells} />}
      <Text color={AMBER_TEXT} bold>
        ACCOUNT STATUS
      </Text>
      {account === null && <Text color={UNLIT_TEXT}>NO USAGE READING YET</Text>}
      {account !== null &&
        account.limits.map((limit, index) => {
          const percent = left(limit)
          const on = Math.ceil((percent / 100) * columns)
          const resets = limit.resetsAt === undefined ? '' : ` · ${span(Date.parse(limit.resetsAt) - now)}`
          const figures = ` ${percent}%${resets}`
          // The full name where it fits beside the figures on one row, the short one where it does not.
          const full = WINDOW_NAMES[limit.kind] ?? limit.kind
          const name = cells(full) + figures.length <= columns ? full : (WINDOW_SHORT_NAMES[limit.kind] ?? limit.kind)

          return (
            <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
              <Text color={AMBER_TEXT} wrap="truncate-end">
                {name}
                <Text color={LAMP_COLORS[leftLamp(percent)]}> {percent}%</Text>
                {resets}
              </Text>
              <Text>
                <Text color={LAMP_COLORS[leftLamp(percent)]}>{lit.repeat(on)}</Text>
                <Text color={UNLIT_TEXT}>{dark.repeat(columns - on)}</Text>
              </Text>
            </Box>
          )
        })}
      {account !== null && now - account.at > 120_000 && <Text color={UNLIT_TEXT}>READ {span(now - account.at).toUpperCase()} AGO</Text>}
      <Box flexDirection="column" marginTop={1}>
        <Text color={AMBER_TEXT}>TOKENS THIS WEEK</Text>
        {perModel.length === 0 && <Text color={UNLIT_TEXT}>NONE COUNTED YET</Text>}
        {perModel.map(([model, sum]) => (
          <Text color={AMBER_TEXT}>
            <Text color={modelLamp(model)}>⣿⣿ </Text>
            {cut(modelName(model).toUpperCase(), columns - 11).padEnd(Math.max(0, columns - 11))}
            {count(sum).toUpperCase().padStart(8)}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

// The two rules in the conversation. One, dim, stands above each prompt the
// person typed, so that one exchange is told from the next. The other, lit,
// stands above the model's closing answer to a prompt, so that the answer is
// told from the log of work above it. Both are part of how a row is drawn and
// are stored nowhere: the transcript, a copy of it and what the model reads
// are as they were.
//
// The closing answer is the first text the model wrote in a response that
// called no tool. Nothing says so of a row as it is drawn, so the rows are
// followed as they are stored: a row of text opens a reply, a tool call after
// it makes that text a log of the work, and a response that ends having
// called none makes it the answer. The verdict comes a moment after the row
// is first drawn, so a row reads its own member of `closingAnswer` as it
// draws, and writing that draws the one row again and no other.
const CLOSING = { plugin: 'agentdock', key: 'closingAnswer' } as const
/** The row that may yet be the answer. */
let opening: string | null = null
/** The rows that are. */
const closing = new Set<string>()
/** Every row of text stored since this load: each is judged above, or will be. */
const own = new Set<string>()
/** The closing answers of what was stored before this load (a resumed session, a reload), each by its text; read once, when such a row is drawn. */
let earlier: Promise<ReadonlySet<string>> | null = null

/** A rule's width where the place it is drawn in has not been measured. */
const RULE_FALLBACK_COLUMNS = 40
/** The rule between exchanges: a row of single dark lamps. */
const EXCHANGE_LAMP = '⠂'
/** The rule above an answer: a row of lit lamps. */
const ANSWER_LAMP = '⠶'

const rule = (lamp: string, columns: number | undefined): string => lamp.repeat(Math.max(0, Math.floor(columns ?? RULE_FALLBACK_COLUMNS)))

/** What a stored row the model wrote holds, block by block: text the person reads, or a tool call. Thinking, and text that is only space, are neither. */
function replyBlocks(content: readonly { type: string; text?: unknown }[]): ('text' | 'tool')[] {
  const kinds: ('text' | 'tool')[] = []
  for (const block of content) {
    if (block.type === 'tool_use') kinds.push('tool')
    else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') kinds.push('text')
  }
  return kinds
}

/**
 * The closing answers of a stored conversation, each by its text, trimmed:
 * the rows carry no id. A text that is an answer in one place and a log in
 * another is told apart by nothing, and is left out, so that no rule is drawn
 * where one might be wrong.
 */
function closingAnswers(messages: readonly { role: string; text: string; toolUses: readonly unknown[]; toolResults?: readonly unknown[] }[]): Set<string> {
  const answers = new Set<string>()
  const logs = new Set<string>()
  let open: string | null = null
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (message.toolUses.length > 0 && open !== null) {
        logs.add(open)
        open = null
      }
      const text = message.text.trim()
      if (text === '') continue
      if (open === null) open = text
      else logs.add(text)
    } else if ((message.toolResults?.length ?? 0) === 0 && open !== null) {
      answers.add(open)
      open = null
    }
  }
  if (open !== null) answers.add(open)
  for (const text of logs) answers.delete(text)
  return answers
}

/** The reply's opening text turned out to be its closing answer: the row is drawn again, with its rule. */
function closeReply($: EngineInterface) {
  if (opening === null) return
  const id = opening
  opening = null
  closing.add(id)
  // A write the engine does not take is not a rule lost: every row is asked again.
  const askAll = () => $.ui.invalidate('ui.render')
  void $.state.set({ ...CLOSING, id }, true).then(written => {
    if (!written.isSet) askAll()
  }, askAll)
}

/** Whether a row of the model's text opens the closing answer to a prompt. The state is read for what the read does as much as for its answer: the row is drawn again when its value is written. */
async function isClosingAnswer($: EngineInterface, id: string, text: string): Promise<boolean> {
  const held = await $.state.get({ ...CLOSING, id }).catch(() => undefined)
  if (closing.has(id) || held?.value === true) return true
  if (own.has(id)) return false
  earlier ??= $.session
    .messages()
    .then(closingAnswers)
    .catch(() => {
      earlier = null
      return new Set<string>()
    })
  return (await earlier).has(text.trim())
}

// Where the sign is drawn now and what its line says, for the timer to repaint.
// Lost on a reload, and set again by the next draw.
let drawn: { requestId: string; columns: number; line: string } | null = null

/** What Account Status draws from, read while a site draws, and where the sign is noted for the timer. */
async function gather($: EngineInterface, requestId: string, columns: number, hasRaster: boolean): Promise<Status> {
  const account = await read($, reading)
  const perModel = Object.entries((await read($, week))?.tokens ?? {}).sort((a, b) => b[1] - a[1])
  const now = await $.clock.now()
  const isMoving = hasRaster && (await read($, isUfoOn))
  const line = runningLine(account, perModel, await read($, active), now)
  drawn = isMoving ? { requestId, columns, line } : drawn?.requestId === requestId ? null : drawn

  return { account, perModel, now, columns, cells: isMoving ? sign(Math.floor(now / FRAME_MS), columns, line) : null }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dock',
      description: 'Open the AgentDock pane; "/dock status" moves Account Status, "/dock ufo" switches the moving sign, "/dock rules" the rules in the conversation',
      argumentHint: '[status|ufo|rules]',
    })
    const usage = await $.session.usage()
    if (usage.rateLimits.length > 0) await keepReading($, usage.rateLimits)
    else {
      const stored = asReading(await $.store.get(STORED_READING))
      if (stored !== null) await update($, reading, () => stored)
    }
    const counted = currentWeek(asWeek(await $.store.get(STORED_WEEK)), weekEnd(await read($, reading)))
    await update($, week, () => counted)
    if ((await $.store.get(STORED_UFO)) === false) await update($, isUfoOn, () => false)
    if ((await $.store.get(STORED_PLACE)) === 'band') await update($, statusAt, () => 'band')
    if ((await $.store.get(STORED_RULES)) === false) await update($, areRulesOn, () => false)
    await refreshActive($)
    // Unasked, the engine places a pane only in a terminal of 144 columns or more.
    // In a narrower one nothing would show the pane is there at all, so it says how to open it.
    void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS }).then(opened => {
      if (!opened.isPlaced) $.ui.toast('AgentDock: type /dock to open the pane')
    })
    $.clock.every(FRAME_MS, async () => {
      if (drawn === null) return
      const { requestId, columns, line } = drawn
      const answer = await $.ui.blit({ requestId, key: 'sign', cells: sign(Math.floor((await $.clock.now()) / FRAME_MS), columns, line) })
      // No longer mounted, or at another size: wait for the next draw to say where it is.
      if (answer.deny !== undefined && drawn?.requestId === requestId && drawn.columns === columns) drawn = null
    })

    return next(e)
  })

  on('command.run', { command: 'dock' }, async ($, e) => {
    const asked = e.args.trim()
    if (asked === 'ufo') {
      const isOn = !(await read($, isUfoOn))
      await update($, isUfoOn, () => isOn)
      await $.store.set(STORED_UFO, isOn)

      return { text: isOn ? 'The moving sign is back.' : 'The moving sign is off. "/dock ufo" brings it back.' }
    }
    if (asked === 'rules') {
      const isOn = !(await read($, areRulesOn))
      await update($, areRulesOn, () => isOn)
      await $.store.set(STORED_RULES, isOn)

      return { text: isOn ? 'The rules are drawn in the conversation.' : 'The rules are off. "/dock rules" brings them back.' }
    }
    if (asked === 'status') {
      const place = (await read($, statusAt)) === 'top' ? 'band' : 'top'
      await update($, statusAt, () => place)
      await $.store.set(STORED_PLACE, place)
      if (place === 'top') await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })

      return { text: place === 'top' ? 'Account Status is at the top of the pane.' : 'Account Status is above the prompt.' }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })

    return { text: opened.isPlaced ? 'AgentDock pane opened.' : 'The AgentDock pane could not be placed here.' }
  })

  on('session.measure', async ($, e, next) => {
    await keepReading($, e.rateLimits)

    return next(e)
  })

  // Seen, never decided: every type is offered as it would be without this mod.
  on('agent.offer', async ($, e, next) => {
    const offered: DockAgentType = { agent: e.agent, description: e.description, source: e.source }
    await update($, available, list => [...list.filter(one => one.agent !== offered.agent), offered])

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await refreshActive($)

    return spawned
  })

  // The rows the main loop's model writes, as they are stored, a block a row:
  // text opens a reply unless one is open, and a tool call after it means that
  // text was not the answer. A subagent's rows are its own conversation's.
  on('session.append', { door: 'response' }, ($, e, next) => {
    if (e.agentId === undefined) {
      for (const kind of replyBlocks(e.message.content)) {
        if (kind === 'tool') opening = null
        else {
          own.add(e.uuid)
          opening ??= e.uuid
        }
      }
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    // A response of the main loop that called no tool is where its turn ends:
    // the text it opened with is the answer. One that called any wrote a log.
    if (e.agentId === undefined) {
      if (step.toolUses.length === 0) closeReply($)
      else opening = null
    }
    const usage = step.usage
    if (usage !== null) {
      const sum = usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      await addTokens($, usage.model, sum)
    }
    await refreshActive($)

    return step
  })

  on('turn.complete', async ($, e, next) => {
    // A turn cut short leaves a reply open that no response closed: what it last wrote is all the answer there is.
    if (e.agentId === undefined) closeReply($)
    await refreshActive($)

    return next(e)
  })

  // Another conversation takes this one's place (a /clear, a resume from
  // inside the session): what was followed of the old one says nothing of the new.
  on('session.end', ($, e, next) => {
    opening = null
    closing.clear()
    own.clear()
    earlier = null

    return next(e)
  })

  // The rule between exchanges, above each prompt the person typed. A row of
  // any other origin (a subagent's message, a notification) is the engine's own.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer' || !(await read($, areRulesOn))) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text color={UNLIT_TEXT} wrap="truncate-end">
          {rule(EXCHANGE_LAMP, e.viewport?.columns)}
        </Text>
        {await next(e)}
      </Box>
    )
  })

  // The rule above the closing answer. A row is first drawn before its
  // response has ended, so the rule arrives with the redraw the verdict asks for.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary || !(await read($, areRulesOn))) return next(e)
    if (!(await isClosingAnswer($, e.requestId, e.props.text))) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text color={AMBER_TEXT} wrap="truncate-end">
          {rule(ANSWER_LAMP, e.viewport?.columns)}
        </Text>
        {await next(e)}
      </Box>
    )
  })

  // Account Status in the band above the prompt: where the person moved it
  // there, and wherever the pane, whose top is its place, is not drawn.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isPaneUp = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
    const isHere = (await read($, statusAt)) === 'band' || !isPaneUp
    // A survey has the band while it is up.
    if (e.props.hasSurvey || !isHere) {
      if (drawn?.requestId === e.requestId) drawn = null
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : null
    const columns = Math.max(24, Math.min(SIGN_MAX_COLUMNS, e.props.bodyColumns)) - FRAME_COLUMNS

    return statusTree(Box, Text, Raster, await gather($, e.requestId, columns, Raster !== null))
  })

  // The pane docked at the right, in two halves, each in a frame of its own:
  // Account Status at the top, which is the top of the screen, in amber, and
  // Agents under it, in green.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : null
    const columns = Math.max(20, e.props.bodyColumns) - FRAME_COLUMNS
    const isStatusHere = (await read($, statusAt)) === 'top'
    const status = isStatusHere ? await gather($, e.requestId, columns, Raster !== null) : null
    if (!isStatusHere && drawn?.requestId === e.requestId) drawn = null
    // Claude Code's own types first, then the rest as they were offered: a long run of
    // plugin types would otherwise stand above the ones every session has.
    const offered = await read($, available)
    const types = [...offered.filter(one => one.source === 'built-in'), ...offered.filter(one => one.source !== 'built-in')]
    const agents = await read($, active)
    // Both lists are drawn whole. A pane taller than its room scrolls, and a type cut from the list could not be pressed.

    return (
      <Box flexDirection="column">
        {status !== null && statusTree(Box, Text, Raster, status)}
        <Box flexDirection="column" width={columns + FRAME_COLUMNS} backgroundColor={BOARD_TEXT} borderStyle="single" borderColor={GREEN_TEXT}>
          <Text color={GREEN_TEXT} bold>
            AGENTS
          </Text>
          <Text color={GREEN_TEXT}>ACTIVE</Text>
          {agents.length === 0 && <Text color={UNLIT_GREEN_TEXT}>NONE AT WORK</Text>}
          {agents.map(agent => (
            <Text color={GREEN_TEXT} wrap="truncate-end">
              <Text color={STATUS_LAMPS[agent.status] ?? UNLIT_GREEN_TEXT}>⣿ </Text>
              {cut(`${agent.type} ${agent.status}`, columns - 2)}
            </Text>
          ))}
          <Text> </Text>
          <Text color={GREEN_TEXT}>AVAILABLE</Text>
          {types.length === 0 && <Text color={UNLIT_GREEN_TEXT}>LISTED AFTER A TURN</Text>}
          {types.length > 0 && <Text color={UNLIT_GREEN_TEXT}>TYPE A TASK, PRESS ONE</Text>}
          {types.map(type => (
            <Button key={`send:${type.agent}`} plain onPress={() => dispatch($, type.agent)}>
              <Text color={GREEN_TEXT}>{cut(type.agent, columns)}</Text>
            </Button>
          ))}
        </Box>
      </Box>
    )
  })
}
