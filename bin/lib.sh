# Shared by bin/sync, bin/install, bin/purge (sourced). Bash 3.2 compatible.

AGENTS_DIR="$HOME/.agents"
# Bare repo: env override, else the git dir a hook runs in, else the known layouts
# (~/GitHub/eimerreis/<repo> new, ~/GitHub/<repo> old; same as the `skills` command)
if [[ -z "${SKILLS_GIT_DIR:-}" ]]; then
  if [[ -n "${GIT_DIR:-}" ]]; then
    SKILLS_GIT_DIR="$GIT_DIR"
  else
    for d in "$HOME/GitHub/eimerreis/skills" "$HOME/GitHub/skills"; do
      [[ -d "$d" ]] && { SKILLS_GIT_DIR="$d"; break; }
    done
  fi
fi
[[ -n "${SKILLS_GIT_DIR:-}" ]] || { echo "skills: repo not found (set SKILLS_GIT_DIR)" >&2; exit 1; }
SKILLS_GIT_DIR=$(cd "$SKILLS_GIT_DIR" && pwd)
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
MANIFEST="$AGENTS_DIR/skills.json"
# Optional, not tracked here (public repo): private sources such as work repos, same shape as
# skills.json. Its skills are installed and kept like declared ones; `install` never writes it.
LOCAL_MANIFEST="$AGENTS_DIR/skills.local.json"
LOCK="$AGENTS_DIR/.skill-lock.json"
cd "$AGENTS_DIR"
sk() { git --git-dir="$SKILLS_GIT_DIR" --work-tree="$AGENTS_DIR" "$@"; }
say() { echo "skills: $*"; }
# Git shell aliases forward the caller's arguments to the audit command.
sk config alias.usage '!exec "$HOME/.agents/bin/audit-skill-usage"'
# Uncommitted skills.json edits (tried-out skills) must not block `skills pull`
[[ "$(sk config --get merge.autostash 2>/dev/null)" == true ]] || sk config merge.autostash true

need_tools() {
  command -v jq >/dev/null || { say "jq missing" >&2; return 1; }
  if ! command -v npx >/dev/null && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    . "$HOME/.nvm/nvm.sh" >/dev/null
  fi
  command -v npx >/dev/null || { say "npx missing" >&2; return 1; }
}

# Skill names npx installed globally (machine-local lock)
locked() { [[ -f "$LOCK" ]] && jq -r '.skills // {} | keys[]' "$LOCK" || true; }
# Installed from a local path (work in progress, e.g. a checkout of a skills repo)
local_installs() {
  [[ -f "$LOCK" ]] && jq -r '.skills // {} | to_entries[]
    | select((.value.source // "") | test("^(/|~|\\.)")) | .key' "$LOCK" || true
}
# Own skills: tracked under skills/ in this repo
own_skills() { sk ls-files -- skills | cut -d/ -f2 | sort -u; }
# Declared skill names of a manifest JSON on stdin
declared() { jq -r '.skills // {} | to_entries[] | .value[]' | sort -u; }
# skills.json with the sources of skills.local.json added
merged_manifest() {
  if [[ -f "$LOCAL_MANIFEST" ]]; then
    jq -s '.[0] + {skills: ((.[0].skills // {}) + (.[1].skills // {}))}' "$MANIFEST" "$LOCAL_MANIFEST"
  else
    cat "$MANIFEST"
  fi
}
# Skill names declared in skills.local.json (empty without it)
local_declared() { if [[ -f "$LOCAL_MANIFEST" ]]; then declared <"$LOCAL_MANIFEST"; fi; }
# Agents from skills.json as `-a a b c` (sets agent_args)
load_agent_args() {
  local agents
  read -ra agents <<<"$(jq -r '(.agents // []) | join(" ")' "$MANIFEST")"
  agent_args=()
  [[ ${#agents[@]} -gt 0 ]] && agent_args=(-a "${agents[@]}")
  return 0
}
