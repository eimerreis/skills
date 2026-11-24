# Personal agent config

Shared agent instructions (`AGENTS.md`), docs, and personal skills, managed as a bare Git repository with `~/.agents` as work tree.

```
~/.agents/
  AGENTS.md          # global instructions for all harnesses
  docs/              # docs referenced from AGENTS.md
  skills/<name>/     # personal skills

  # not tracked here (public repo); tracked in the private eimerreis/dotfiles
  AGENTS.local.md    # private additions, read via AGENTS.md
  skills.local.json  # private skill sources, same shape as skills.json
```

## Setup

```zsh
git clone --bare git@github.com:eimerreis/skills.git "$HOME/GitHub/eimerreis/skills"
alias skills='git --git-dir=$HOME/GitHub/eimerreis/skills --work-tree=$HOME/.agents'
skills checkout
skills config status.showUntrackedFiles no
skills config core.hooksPath '~/.agents/.githooks'
skills config alias.usage '!exec "$HOME/.agents/bin/audit-skill-usage"'
~/.agents/bin/sync
```

## Skills

- **Own skills**: tracked here under `skills/<name>/`; arrive with `skills pull`.
- **Validation**: CI (`.github/workflows/skill-validator.yml`) runs `skill-validator check --strict` on `skills/`; any warning fails. Locally: `skill-validator check --strict skills/<name>` (release binary from agent-ecosystem/skill-validator).
- **Third-party skills**: declared in `skills.json` (hand-maintained):
  `{ "agents": [...], "skills": { "<npx skills source>": ["<skill>", ...] } }`.
  To add or drop one, edit `skills.json`, commit, push, then `skills sync` (or
  `skills pull` on other machines). Don't use `npx skills add/remove -g` directly; sync
  would undo it.
- **Try out**: `skills install <source> [skill ...]` installs via `npx skills add -g` and
  declares it in `skills.json` without committing (sync keeps it on this machine).
  Keep it: `skills commit -m "..." skills.json && skills push`. Drop it: `skills purge`
  removes every skill the committed `skills.json` doesn't declare, plus its uncommitted
  entries (`--dry-run` lists them). Own skills and local-path installs stay.
  `merge.autostash` keeps `skills pull` working with an edited `skills.json`.
- **Sync**: `skills sync` (`~/.agents/bin/sync`) installs declared skills that are missing (`npx skills add -g`
  for the declared agents) and removes npx-installed skills that are not declared.
  Directories that are neither own, declared nor npx-installed are only reported.
  `--pull` fast-forwards this repo first, `--update` also updates installed skills.
  Runs after every `skills pull` (`.githooks/post-merge`).
- **Claude Code** reads only `~/.claude/skills`: sync links every skill there
  (`~/.claude/skills/<name>` → `~/.agents/skills/<name>`) and drops stale links.
  Codex and OpenCode read `~/.agents/skills` directly.
- `.skill-lock.json` is machine-local state of `npx skills` (not tracked).
- **Per-machine opt-out**: `skills config --add skills.excludeSource <substring>` skips
  sources matching it (not installed, removed if present), e.g. a work org on a private
  Mac (`install-mac.sh --private` sets that). `--unset-all skills.excludeSource` undoes it.
- The first sync on a machine never removes anything; it lists what the next run would remove.
- **Private sources**: `skills.local.json` (same `skills` shape, not tracked here) adds sources
  that must stay out of this public repo, e.g. work repos. `sync` installs and keeps them,
  `purge` keeps them, `install` never writes there.

## Harness wiring (tracked in eimerreis/dotfiles)

| Harness  | File                           | Points to                     |
| -------- | ------------------------------ | ----------------------------- |
| Claude   | `~/.claude/CLAUDE.md`          | `@~/.agents/AGENTS.md` import |
| Codex    | `~/.codex/AGENTS.md`           | symlink → `~/.agents/AGENTS.md` |
| OpenCode | `~/.config/opencode/AGENTS.md` | symlink → `~/.agents/AGENTS.md` |

## Usage audits

`skills usage` (`~/.agents/bin/audit-skill-usage`) deterministically counts sessions with observed
skill loads across local Codex, Claude, OpenCode, and T3 histories. TypeScript on
Bun 1.3+; no runtime dependencies or AI calls. Supports date filters, wrapper groups, and JSON
snapshots. Setup and sync register the Git alias, which forwards all audit flags.
Only installed skills are listed by default, including those with zero recorded
usage. Use `skills usage --top 10` for the most used, `--last 10` for the least
used, or `--include-uninstalled` to include removed skills. Terminal output is a
bordered table; `--format json` retains machine-readable reports.
See [audit instructions](docs/skill-usage-audits.md).

## Use

Only explicitly added paths are tracked; skills installed via `npx skills` stay untracked:

```zsh
skills add skills/lean-grill
skills commit -m "Add lean-grill skill"
skills push
```
