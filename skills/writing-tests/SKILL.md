---
name: writing-tests
description: Use when writing, changing, reviewing, or deciding whether to keep a test, in any stack (.NET, React, TypeScript). Tests assert what callers can observe (return values, HTTP status and body, rendered UI, error codes, requests received by fakes), use literal expected values, and run real code instead of mocking our own. Complements the tdd skill, which covers the red-green loop.
---

# Writing tests

A test is a claim about what the code does for the people and programs that
use it. Write it so it fails when that behaviour breaks and keeps passing when
only the internals change. If you can't write a test like that, write no test:
**no new test beats a bad test.**

## Rules

1. **Test what callers can observe.** Return values, thrown error types and
   codes, HTTP status/body/headers, what a user sees on screen, state readable
   through the public API, and effects on systems outside the process. Not
   private helpers, internal call order, or which class did the work.
2. **Expected values are literals from the requirement.** Write `15`, not
   `items.Sum(i => i.Price)`. Never compute the expected value with the code
   under test or the way it computes it.
3. **Don't mock what you can run.** Run the real API in-process, the real
   database in a container, the real component tree. Fake only real outside
   boundaries: third-party HTTP APIs, message brokers, email, the clock. What
   a fake receives is behaviour, so assert on it.
4. **Pair every "nothing happened" assertion with a case where it happens.**
   A test checking "no request was sent" also needs a case proving the test
   can see a request.
5. **Size the assertion to the contract.** Not loose (`Contains("failed")`,
   `NotBeNull()`), not over-pinned (exact equality on fields nobody promised).
6. **Avoid** snapshots of human prose, exact error _messages_ (assert the
   code or type), sleeps and timing races, and assertions on data the test
   built itself.

## Workflow

1. Name the observable behaviour the test covers. No nameable behaviour, no
   test.
2. Pick the seam: the outermost public interface that is still cheap to drive
   (HTTP endpoint, rendered component, exported function).
3. Drive the real code; fake only outside boundaries.
4. Assert on output, status, rendered UI, and what the fakes received.
5. Check the test can fail: break the behaviour briefly and watch it go red.
6. Run the relevant tests and the type check / build.

When reviewing or touching existing tests, apply the same rules: delete or
rewrite tests that pin implementation, recompute their expected values, or
mock our own code.

## References

- [references/principles.md](references/principles.md): each rule in depth,
  with good and bad examples in C# and TypeScript, plus when a unit test is
  still the right call.

Adapted from mcp-use's
[writing-tests skill](https://github.com/mcp-use/mcp-use/blob/main/.claude/skills/writing-tests/SKILL.md),
itself based on Cursor's [pstack](https://github.com/cursor/plugins/tree/main/pstack)
(MIT, © 2026 Lauren Tan).
