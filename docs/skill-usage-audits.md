# Skill usage audits

`bin/audit-skill-usage` runs the TypeScript implementation in
`bin/audit-skill-usage.ts` with Bun 1.3+. It uses Bun's built-in SQLite driver
and Node-compatible file APIs. Running an audit requires no package installation,
AI calls, credentials, or network access. Bun must be available on `PATH`,
including in scheduled jobs.
It never executes commands found in a transcript.

```sh
skills usage
```

## Repeatable reports

```sh
# Rank currently installed skills; zero-usage skills appear in --last.
skills usage --top 10
skills usage --last 10

# Include historical skills that are no longer installed.
skills usage --top 10 --include-uninstalled

# Inclusive UTC dates; stdout is a table by default.
skills usage --since 2026-10-01 --until 2026-10-31

# Stable JSON, suitable for keeping monthly snapshots.
skills usage \
  --since 2026-10-01 --until 2026-10-31 \
  --format json \
  --output "$HOME/.local/state/skill-audits/2026-10.json"

# Account for wrapper skills without counting the same session twice.
skills usage \
  --group grill=grill-me,grilling,grill-with-docs \
  --group lean-grill=lean-grill,lean-grill-with-docs

# Inspect one provider, with event identifiers and timestamps.
skills usage --sources opencode --format json --evidence
```

The `skills` shell alias delegates to Git. Setup and `bin/sync` register the
repository-local `usage` Git alias, forwarding every argument to the audit script.
For an existing installation, register it directly after pulling the command:

```sh
skills config alias.usage '!exec "$HOME/.agents/bin/audit-skill-usage"'
```

The script also remains callable directly as `~/.agents/bin/audit-skill-usage`.

Reports contain no wall-clock generation timestamp. The same unchanged input
histories, installed inventory, and arguments produce identical bytes. Skills
sort by descending session count, then name; `--last N` sorts ascending instead.
Evidence and metadata have stable ordering. Each
SQLite source is read within its own read transaction. Histories still changing
between runs can produce different results; there is no cross-provider snapshot.

Use a local scheduler to run the command regularly. Reports are machine-local:
GitHub Actions cannot access the histories on your Mac. A fixed output path is
replaced atomically; give each run a new path when retaining historical snapshots.
Scheduling is separate from the command; installing it creates no scheduled job.

## Installed inventory and ranking

The default list contains currently installed skills, including installed skills
with no recorded usage. Those skills have a count of zero. `--include-uninstalled`
also includes skills observed in history whose manifests are no longer installed.
This flag does not invent zero-usage rows for removed skills with no history.

`--top N` returns the N most-used skills; `--last N` returns the N least-used
skills, starting with zero usage. Both accept a positive integer and cannot be
combined. Equal counts sort by skill name. Date filters apply before ranking, so
`--since 2026-10-01 --last 10` finds skills unused or least used during that period.

Installed manifests are discovered in these global roots under `--home`:

- `.agents/skills`, `.codex/skills`, `.claude/skills`
- `.config/opencode/skills`, `.config/opencode/skill`, `.opencode/skills`, `.opencode/skill`
- `.claude/plugins/synced`

Symlinks are followed once, including shared installs and `.codex/skills/.system`.
Names come from manifest frontmatter, falling back to directory names for legacy
manifests. Skills remain installed when disabled; this inventory measures presence,
not whether a harness currently allows automatic invocation.

Claude plugins are discovered through `.claude/plugins/installed_plugins.json`.
Codex plugins declared in `.codex/config.toml` use their newest cached version;
explicit skill paths in that config are also inspected. Unregistered cache entries
are excluded. Project-local and remote-only installs are not inferred from history;
use repeatable `--skills-dir PATH` to supply additional local manifest roots:

```sh
skills usage --skills-dir ./project/.agents/skills --last 10
```

The table shows how many matching skills are displayed and includes an Installed
column with `--include-uninstalled`. JSON adds `installed_skills`, `matching_skills`,
and the ranking/installation flags under `filters`. Ranking limits affect listed
skills and their optional evidence; audit totals and group counts cover all skills
matching the installation and date filters before the display limit.

## What counts

The primary metric is **provider sessions with observed skill loads**, once per
skill per session. It is not an exact count of invocations or completed workflows.

Evidence comes from:

- Native `skill` / `Skill` calls. OpenCode calls must have completed; explicit
  failure results in Claude and Codex are excluded.
- Literal manifest reads through file-reading tools and common shell commands.
- Host-expanded skill prompts containing `Base directory for this skill:`.

Ordinary mentions, skill catalogs, reasoning, tool outputs, and writes to skill
files are not counted. A loaded skill's name is normalized to its basename;
installations and versions with that same name are combined. Groups count the
union of their members' sessions, rather than adding the member counts.

Subagent sessions count separately. Histories inherited by a fork may count again
under the fork's session. Reading a manifest while reviewing or editing a skill
can count as usage. Manifest reads are a proxy: they do not prove the workflow ran.
Missing or encrypted history, dynamic shell paths, and unsupported host formats
can omit loads. Codex JSONL calls without a matching result are omitted.

`--since` and `--until` filter evidence timestamps by UTC day, inclusively.
`sessions_scanned` counts all saved sessions inspected, including those without
matching evidence. `sessions_with_loads` counts sessions matching the filters.
`observed_utc_range` describes only matching skill evidence.

## Sources and deduplication

Paths are relative to `--home` (default: your home directory):

| Source | Location |
|---|---|
| Codex rollouts | `.codex/sessions/**/*.jsonl`, `.codex/archived_sessions/**/*.jsonl` |
| Codex projected commands | `.codex/thread_history_1.sqlite` |
| Claude sessions and subagents | `.claude/projects/**/*.jsonl` |
| OpenCode legacy and v2 sessions | `.local/share/opencode/opencode.db` |
| T3 retained history | `.t3/userdata/statev2.sqlite` |

OpenCode legacy `part` records and v2 `session_message` content share native
session identities. T3 imports resolve back to native provider thread IDs, or
unambiguous native tool IDs. Repeated reads, migrated records, and native/T3
copies of the same skill/session do not inflate the primary metric. Unresolved
T3 identities remain separate and can duplicate a native session.

Provider storage formats are local implementation details. The scanner supports
the table/record shapes covered by its fixtures; it reports missing sources and
schema/parse errors rather than silently treating them as zero usage. Native
histories removed from disk are not recoverable by this script.

Use `--exclude-cwd /absolute/path` to omit whole sessions belonging to a working
directory, for example the session in which you developed an audit. No directory
is implicitly excluded. `--sources` selects providers and always processes T3
after native histories, independent of argument order.

Exit status is `0` for a complete scan of the available supported sources, `1`
for a partial/failed scan or no sources, and `2` for invalid arguments. Missing
unselected/uninstalled providers are normal. Errors are included in the report;
`--verbose` sends source progress to stderr without changing report bytes.
`--output` refuses to overwrite the known source files or rollout directories.
Default JSON omits event details; `--evidence` adds session IDs and timestamps,
which may be private. Neither mode includes transcript bodies or commands.

## Validation

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
```

Only development needs the pinned TypeScript compiler and Bun type definitions
from `package.json`; the audit command has no runtime npm dependencies.

Tests run the actual CLI against temporary SQLite, JSONL, and skill-installation fixtures. They cover
cross-source deduplication, native errors, expanded wrappers, UTC dates,
working-directory exclusions, deterministic bytes, partial histories, and source
preservation, plus ranking, unused skills, plugin registries, symlinks, and table
alignment. Fixtures contain no personal history.
