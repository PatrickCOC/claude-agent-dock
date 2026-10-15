# AgentDock

AgentDock is a [Claude Code](https://code.claude.com) plugin (a "mod") that draws a side pane inside Claude Code, styled as an early-2000s dot-matrix sign: red, green and amber lamps on black, a running line of text and a small UFO-and-cow animation.

It shows usage and agent status, hands tasks to agents, and marks the conversation:

- **Usage.** Account Status: the five-hour and weekly usage windows as bars (what is left, and the time to reset), plus the tokens each model has been sent and sent back this week. Reading the windows costs no model request.
- **Agent status.** Agents: the subagents running in the session and where each stands, and every agent type the session offers.
- **Quick background dispatch.** Type a task in the prompt box and, instead of Enter, press an agent type in the pane. An agent of that type starts on the task at once, in the background. You choose the agent; the model is not asked whether to delegate.
- **Conversation rules** (display only). A dark rule above each prompt you typed and a lit rule above the model's closing answer, so one exchange is easy to tell from the next. The transcript is unchanged.

The product name is **AgentDock**; the repository is `claude-agent-dock`. The plugin is `agentdock`, and its command is `/dock`.

## Install

In Claude Code:

```text
/plugin marketplace add PatrickCOC/claude-agent-dock
/plugin install agentdock@agentdock
```

To try it from a clone without installing:

```powershell
git clone https://github.com/PatrickCOC/claude-agent-dock.git
cd claude-agent-dock
claude --plugin-dir mod
```

The pane opens by itself where the terminal is at least 144 columns wide. In a narrower one, type `/dock`, which opens it at any width; until then Account Status is shown above the prompt.

| Command | Does |
| --- | --- |
| `/dock` | Opens the pane |
| `/dock status` | Moves Account Status between the top of the pane and the band above the prompt |
| `/dock ufo` | Switches the moving sign off and on |
| `/dock rules` | Switches the two conversation rules off and on |

`mod/README.md` describes each part, where its data comes from and how the dispatch works.

## Known limitations

- The mod API is early access by Claude Code's own word and may change between releases. Verified on Claude Code 2.1.296 and Windows 11; `claude plugin validate` and `claude plugin test` were also run on 2.1.300. Other platforms were not tried.
- "Tokens this week" is what sessions with this mod loaded counted since it was first loaded. It is not the account's own figure (Claude Code gives a mod only a percentage), and two sessions that answer in the same instant can lose one of the two additions.
- The pane is one session's. Whether it is drawn in agent view was not tried.
- A task goes to one agent per press. The agent's model and permissions cannot be set from the pane: they are the agent type's own. Only agent types the session has offered can be pressed, and a session offers them once its first turn has run.
- The running line is in capitals and figures (its lamps have no Chinese glyphs). A braille cell has one colour, so where two lamps of different colours share a cell, one colour wins. Models are a coloured block, not an icon; agents have no icon.
- A mod cannot draw over the conversation, so Account Status sits at the top of the pane rather than above the chat.
- Another mod that draws in the band above the prompt (for example the Claude Session Monitor mod) and this one cannot both have it while Account Status is there. They were not tried together.

## Develop

The mod is one hooks module, `mod/hooks/register.tsx`, with no build step and no runtime dependencies. From the repository root, with Claude Code installed:

```powershell
claude plugin validate .      # marketplace manifest
claude plugin validate mod    # plugin, types and hooks
claude plugin test mod        # tests in mod/tests
```

`tsc -p mod` type-checks the mod once Claude Code has loaded it from this folder and laid its types in `mod/.claude-plugin/types/` (not kept in git).

## License

MIT, see `LICENSE`. `NOTICE.md` carries the notice for the Claude Session Monitor project that the conversation rules derive from, which is under the same license.
