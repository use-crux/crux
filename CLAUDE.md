@AGENTS.md

# Personal preferences

## Code style
- Always strive for concise, simple solutions
- If a problem can be solved in a simpler way, propose it.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI is near-free for me) not a list price. Intelligence is how hard a problem you can hand to model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model    | cost | intelligence | taste |
| gpt-5.5  | 9    | 8            | 5     |
| sonnet-5 | 5    | 5            | 7     |
| opus-4.8 | 4    | 7            | 8     |
| fable-5  | 2    | 9            | 9     |

How to apply:
- These are defaults, not limits. You have standing persmission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model. Judge the output. Escalating costs less then shipping mediocre work.
- Bulk/mechanical work (clear-spec, implementation, data analysis, migrations): gpt-5.5 - It's effectively free.
- Anything user-facing (UI, copy, API design) needs taste >= 7.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally gpt-5.5 as an extra independent perspective.
- Mechanics: gpt-5.5 is only reachable through the Codex CLI - `codex exec` / `codex review`.
