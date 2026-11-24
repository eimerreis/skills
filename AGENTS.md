# AGENTS.MD

## Output

- Work style: telegraph; noun-phrases ok; drop grammar; min tokens.
- Always write one sentence per line
- Default to answers under 120 words in plain sentences. 
- Go longer only when the task needs it, such as requested depth, code, or a draft to send.

## Coding Behavior

- Treat codebases as if you were the owner and long-term maintainer of this codebase, and its design is up to you.

## Pull requests

- Asked to merge once checks are green: run `gh pr merge --auto --squash <pr>` right after opening the PR, and GitHub merges when the required checks pass. Fall back to watching checks only where auto-merge is disabled.
- Never poll checks with `sleep` loops.

## Effort estimates

- Coding agent does the work → estimate in agent terms: scope (files/modules/systems touched), complexity, risk, unknowns; size S/M/L.
- Human time units (person-days, dev hours) misstate cost; leave out.

## Language

- Code always English: identifiers, comments, commits, PR texts, in-repo docs, log/error messages. Holds even when chat is German.
- User sometimes writes German. Topic clearer in English (naming, domain terms landing in code, technical nuance) → stop work, propose switch; after OK continue in English.

## URLs

- If a URL is supplied as context of a task, try to access it with headless methods first
- if browser interaction is necessary, try to use playwright first.

## Technology Specific Instructions

If using one of the below technologies, read the corresponding docs before starting work.

- [React](~/.agents/docs/code/react.md)
- [.NET](~/.agents/docs/code/dotnet.md)

## Personal repos (bare git, no checkout)

- Skills: `eimerreis/skills`, work tree `~/.agents`. Own skills in `skills/<name>/`; third-party skills listed in `skills.json`. This AGENTS.md is tracked here; the repo is public.
- Dotfiles: `eimerreis/dotfiles` (private), work tree `~/`. Tracks `~/.agents/AGENTS.local.md` and private docs under `~/.agents/docs/`.
- Bare git dir: `~/GitHub/eimerreis/<repo>` or `~/GitHub/<repo>`; use the one that is bare (`HEAD` at top level, no `.git/`). A regular clone can also exist at the other path.
- Shell aliases `skills` / `dotfiles` exist only in interactive zsh; agents run `git --git-dir=<bare dir> --work-tree=<tree> …`.
- "Add to my skills/dotfiles" means commit to that repo; push only when asked.

## Private additions

- If `~/.agents/AGENTS.local.md` exists, read it too; it holds machine- and account-specific rules that stay out of this public repo.
