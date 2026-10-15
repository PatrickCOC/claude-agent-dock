/** One usage window of the account, as the session last reported it. */
export type DockLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** The account's usage windows and when they were read, by the clock. */
export type DockReading = { limits: DockLimit[]; at: number }

/** An agent type the session offers: its name, when to use it, and where it is defined. */
export type DockAgentType = { agent: string; description: string; source: string }

/** An agent at work in this session. */
export type DockAgent = { id: string; type: string; description: string; status: string }

/**
 * Tokens a model in the account's week: every token each model was sent and
 * sent back, by the sessions that had this mod. `endsAt` is when that week
 * ends, to the hour; null while no reading has said.
 */
export type DockWeek = { endsAt: string | null; tokens: Record<string, number> }

declare module 'claude-code' {
  interface PluginState {
    agentdock: {
      reading: DockReading | null
      available: DockAgentType[]
      active: DockAgent[]
      week: DockWeek | null
      isUfoOn: boolean
      statusAt: 'top' | 'band'
      areRulesOn: boolean
      /** One value a row of the model's text, by the row's id: true once the row is known to open the closing answer to a prompt. */
      closingAnswer: StateFamily<boolean>
    }
  }
}
