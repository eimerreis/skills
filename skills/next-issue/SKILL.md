---
name: next-issue
description: Finds and recommends the next open issue to tackle from the relevant issue tracker. Use when the user asks what issue, ticket, or GitHub issue to work on next, or requests a summary of open or stale issues.
---

# Next Issue

Give the user a compact, evidence-based view of the open queue and one clear next choice.

## Workflow

1. Resolve the tracker in this order:
   - An issue URL, tracker name, repository, project, or filter in the prompt.
   - Repository guidance such as `AGENTS.md` or `docs/agents/issue-tracker.md`.
   - The current repository's configured remote or tracker CLI context.
   - If still ambiguous, ask one short clarification question.
2. Query all open issues with title, body, labels, assignees, milestone, creation/update dates, dependencies, and comments when available. Respect prompt filters. Use the tracker's CLI or API; for GitHub prefer `gh`.
3. Summarize each issue in at most two short lines: what outcome it seeks, then its readiness, blockers, priority, or important context. Include its identifier and link.
4. List **Potentially stale** issues separately. Treat no meaningful activity for 60 days as a signal, not proof; account for explicit waiting or long-term labels and state why each item may be stale.
5. Recommend exactly one issue. Prefer, in order: ready and unblocked work, explicit priority or severity, user/product impact, dependency-unblocking value, then a small well-defined slice. Explain the choice in one or two sentences. Never invent priority from issue number alone.

## Output

```markdown
## Open issues
#123 Title - link
Outcome summary. Readiness, blocker, or priority context.

## Potentially stale
#98 Title - link - no meaningful activity for N days; reason it needs review.

## Recommendation
Tackle #123 next. Brief evidence-based reason.
```

Omit the stale section when empty. If no open issue is actionable, recommend the issue that should be clarified or unblocked next and say what is needed.
