---
name: lean-grill
description: Run a lean, MVP-focused grill on a plan, decision, or idea. Use when the user says "lean grill" or wants to sharpen the next buildable version rather than the perfect long-term design. Pass "docs" to also capture ADRs and glossary terms.
---

Call the Skill tool with "grilling" and run it as written, with these lean overrides:

- **Goal**: sharpen the next buildable version, not the perfect long-term architecture.
- **Frontier**: only decisions that block implementation or materially change the MVP. Skip branches that don't affect the next one or two iterations.
- **Recommendations**: for each question, add why the recommended answer is good enough for the MVP and which risk or future decision it parks. Prefer fast, reversible decisions.
- **Parked risks**: a real but non-blocking concern goes on a running "Parked risks" list; continue.
- **Done**: when there is enough shared understanding to build the first useful version, not when the whole tree is visited. Summarize:
  - MVP scope
  - Decisions made
  - Assumptions
  - Parked risks
  - Recommended next action

Do not act on the plan until the user confirms the summary.

If the user asks for docs (or passes "docs"), also call the Skill tool with "domain-modeling" and record ADRs and glossary terms as decisions settle.
