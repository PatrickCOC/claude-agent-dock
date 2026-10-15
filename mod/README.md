# AgentDock mod

Account Status and Agents, drawn inside Claude Code by Claude Code itself: nothing else runs. It is drawn as a dot-matrix sign of the kind the MTR ran news on in the early 2000s: lamps of red, green and amber on black, a line that runs right to left, and a small animation.

It is one pane, docked at the right of the conversation, in two halves, each in a frame of its own: Account Status at the top in amber, and Agents under it in green. From the top:

| Part | Shows | From |
| --- | --- | --- |
| The moving sign | A running line that spells out every figure below it, over a scene: a UFO lifts a cow, carries it across and sets it down; the empty ship then flies home ahead and waits, and the cow walks back under its own power | A grid of braille cells, a lamp a dot, repainted ten times a second. Nothing reads it; `/dock ufo` switches it off and on |
| Account Status | 現金 (the five-hour window) and 備用錢 (the weekly window), each under its own name with a bar of its own: what is left, and the time to its reset. Green, amber under 40%, red under 15% | `$.session.usage()` at the session's start and `session.measure` after each turn. Free: no model request |
| Tokens this week | A lamp and a number a model, no bar: every token it was sent and sent back in the account's week, cache reads and writes included | Each `turn.step`'s usage, added to a count kept across sessions |
| Agents, active | The subagents of this session and where each stands | `$.agent.list()` |
| Agents, available | Every agent type the session offers, each one a button: Claude Code's own first, then the installed ones | `agent.offer`, watched and never decided |

## Handing a task to an agent

Type the task in the prompt box and, in place of Enter, press an agent type in the pane: with the mouse, or with the keys once the pane has them (ctrl+x tab, the arrows, Enter). An agent of that type starts on the task at once, in the background, and the box is emptied. The person chose the agent; the model is not asked whether to delegate.

The agent is then listed under Active. When it finishes, Claude Code hands its report to the main conversation as it does for any background agent, and the main model reads it and answers: that answer is a model turn of its own.

With nothing typed, no agent starts and a toast says what to do. Where Claude Code refuses to start one, the task stays in the box and the toast gives the reason.

Only agent types the session has offered can be pressed, and a session offers them once its first turn has run. An agent type that is not installed is not in the list: installing one is still `.claude/agents` or a plugin.

## The rules in the conversation

Two rules are drawn in the conversation itself, so that it is easier to read back.

| Rule | Where | Says |
| --- | --- | --- |
| A row of dark lamps | Above each prompt you typed | Here one exchange ends and the next begins |
| A row of lit lamps | Above the model's closing answer to a prompt | Above this is the log of the work; below it is the answer |

The closing answer is the first text the model wrote in a response that called no tool. What it writes on its way there (the text before a tool call, a tool's row, a subagent's messages) has no rule. The rule arrives as the answer's response ends and not while it streams, since until then nothing says whether a tool call follows.

Both rules are part of how a row is drawn and are stored nowhere: the transcript, a copy of it and what the model reads are unchanged. A conversation resumed from before has the rules of its earlier answers too, each known by its text, and one that reads the same as a line of work elsewhere is left without. `/dock rules` switches both off and on.

This is carried over from the Claude Session Monitor mod (<https://github.com/PatrickCOC/claude-session-monitor>), which has the same two as its conversation and response dividers. The two mods are not meant to be run together.

## Where Account Status is

At the top of the pane, which is the top of the screen. Ideally it would sit over the conversation, but a mod has no place to draw there: a box drawn above the band over the prompt is cut off at the band's edge, which was tried. The two places a mod has are the pane and the band above the prompt.

`/dock status` moves Account Status to the band above the prompt and back, and the choice is kept. It is also drawn in the band whenever the pane is not on screen, so that it is never nowhere.

## The week

The week is the account's: it ends when the weekly window says it resets, and the count starts again then. It holds only what sessions with this mod loaded were sent and sent back, from the day the mod was first loaded. It is not the account's own figure, which Claude Code gives a mod only as a percentage, and two sessions that answer in the same instant can lose one of the two additions.

## Install

In Claude Code:

```text
/plugin marketplace add PatrickCOC/claude-agent-dock
/plugin install agentdock@agentdock
```

Or try it from a clone, without installing:

```powershell
git clone https://github.com/PatrickCOC/claude-agent-dock.git
cd claude-agent-dock
claude --plugin-dir mod
```

The pane opens by itself where the terminal is at least 144 columns wide, which is the engine's rule for a pane nobody asked for; in a narrower one a toast says to type `/dock`, which opens it at any width, and until then Account Status is above the prompt.

| Command | Does |
| --- | --- |
| `/dock` | Opens the pane |
| `/dock status` | Moves Account Status between the top of the pane and the band above the prompt |
| `/dock ufo` | Switches the moving sign off and on |
| `/dock rules` | Switches the two rules in the conversation off and on |

## Check

From the repository root, with Claude Code installed:

```powershell
claude plugin validate .      # the marketplace manifest
claude plugin validate mod    # the plugin, its types and its hooks
claude plugin test mod        # the tests in mod/tests
```

`tsc -p mod` type-checks it once Claude Code has loaded the mod from this folder and laid its types in `mod/.claude-plugin/types/`, which is not kept in git.

## What it does not do

- The running line is in capitals and figures: its lamps have no Chinese glyphs. The two windows' Chinese names are ordinary text under it.
- A braille cell has one colour, so where two lamps of different colours share a cell, one colour wins.
- A model's lamp is a block of two cells, not a drawn icon. Agents have no icon.
- A task goes to one agent a press. There is no way to set the agent's model or its permissions from the pane: they are the agent type's own.
- It is one session's. Whether it is drawn in agent view was not tried.
- Another mod that draws in the band above the prompt, as the Claude Session Monitor mod does, and this one cannot both have it while Account Status is there. They were not tried together.

The mod API is early access by Claude Code's own word and may change between releases. Verified on Claude Code 2.1.296, Windows 11.
