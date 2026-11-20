# Test principles, in depth

## Behaviour versus implementation

**Behaviour** is anything a user of the code can observe through the interface
they actually use:

| Surface            | Observable behaviour                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| HTTP API (.NET)    | status code; response body; headers; problem-details `type`/error code; state readable via other endpoints; requests sent to downstream services; messages published |
| Library / service  | return value; thrown exception type or error code; state readable through the public API; effects on outside systems     |
| React component    | what the user sees and can do (role, label, text, enabled/disabled); callbacks the parent passed in; requests sent       |
| CLI / script       | exit code; stdout; stderr; files written; requests sent                                                                  |

**Implementation** is everything else: private helpers, the order of internal
calls, intermediate data, which class or hook did the work, how many times an
internal method ran, component state, CSS class names.

The contract decides, not the shape of the assertion:

- "A request with this body reached the payment provider" is behaviour, because
  the provider sees it. "`IPaymentGateway.Charge` was called" is implementation
  when `IPaymentGateway` is our own wrapper.
- Callers branch on error codes and exception types, so assert those. The
  message is prose for humans; pin it only when the exact wording is the
  requirement.
- Querying our own database to check a write is a side channel. Read it back
  through the API instead (`POST` then `GET`). The database is our
  implementation; a third-party service is not.
- An empty list is the right assertion when "nothing matches" is the
  requirement. It is hollow when the test just needs "something came back".

## Literal expected values

The expected value comes from the requirement, written out in the test.

```csharp
// Bad: expected value is recomputed the way the code computes it.
var expected = lines.Sum(l => l.Quantity * l.UnitPrice);
total.Should().Be(expected);

// Good: the reader can check this against the spec by eye.
total.Should().Be(42.50m);
```

```ts
// Bad: a bug in formatRow is copied into the expectation.
expect(screen.getByRole("row", { name: formatRow(order) })).toBeInTheDocument();

// Good
expect(screen.getByRole("row", { name: "4711 Pending 42.50 €" })).toBeInTheDocument();
```

The same goes for restated constants and generated data. Comparing a constant
to itself never runs the code that uses it. AutoFixture (or any random test
data) is fine for filler the test does not assert on; every value the test
asserts on must be a literal set in the test.

## Don't mock what you can run

Mocks hide the bugs that live in the parts they replace. A controller test
that mocks the service layer cannot see routing, model binding, validation,
serialization, auth, or whether the service is registered in DI at all.

Run the real thing wherever it is cheap:

- **.NET API:** `WebApplicationFactory<Program>` with an `HttpClient`; real
  database via Testcontainers.
- **React:** render the real component tree with Testing Library; query by
  role and label like a user would.

Fake only what you cannot run locally or must not touch from a test:

- **Third-party HTTP APIs:** WireMock.Net (.NET) or MSW (browser/Node). They
  see the real request our HTTP client sends.
- **Message brokers, email, SMS:** an in-memory or containerised fake that
  records what was published/sent.
- **Clock:** `TimeProvider` / `FakeTimeProvider` in .NET, `vi.useFakeTimers`
  for unit-level TS.
- **Framework boundaries that have no runtime in tests** (e.g.
  `next/navigation` in jsdom): `vi.mock` is fine there.

Never mock our own classes, hooks, or modules to reach the code under test.
If a test needs that, test through the outer interface instead.

Treat what a fake receives as part of the assertion. If the requirement is
"checkout charges the card with the order total", assert on the body the
payment fake received:

```csharp
var request = _paymentApi.LogEntries.Should().ContainSingle().Which.RequestMessage;
request.Path.Should().Be("/v1/charges");
request.Body.Should().Be("""{"amount":4250,"currency":"EUR"}""");
```

## "Nothing happened" needs a positive twin

`publishedMessages.Should().BeEmpty()` passes just as well when the fake is
miswired and could never see a message. Pair it with a test in the same class
where the message is published and seen. Strict fakes help: if every
unexpected request fails the test (WireMock.Net with no fallback mapping, MSW
with `onUnhandledRequest: "error"`), registering only the expected routes is
itself the "nothing else happened" check.

## Assertion strength

- **Too loose:** `Contains("failed")` passes for the wrong row;
  `NotBeNull()` / `toBeTruthy()` pass for the wrong object. Use the tightest
  assertion the contract allows.
- **Too tight:** `BeEquivalentTo` / `toEqual` on a whole response pins fields
  the contract does not promise (timestamps, ids, ordering). Assert the fields
  that matter (`toMatchObject`, `BeEquivalentTo(x, o => o.Including(...))`),
  and use full equality only where every field is the contract.

## Things to avoid

- **Snapshots of human prose or markup.** They fail on every wording tweak and
  pass on real regressions hidden in a large blob. Assert on the contract
  parts: a JSON shape clients parse, an error code, an accessible name.
- **Sleeps and timing races.** Never `Task.Delay` / `await sleep(…)` hoping
  something finished. Await the call, wait for the fake to receive the request,
  or use `findBy*` / `waitFor` for UI. If the code polls with a real delay,
  keep polls few or inject the clock.
- **Assertions on data the test built.** If the test creates a fixture and
  then asserts the fixture has a field, the code under test never ran.
- **Testing private methods** or making them internal/public just for tests.

## When a unit test is still right

Spinning up the API or rendering a page costs time. A pure function with a
real contract and many input cases (a parser, a price calculation, a
validation rule, a mapper with edge cases) can be tested directly through its
public API, as long as:

- its inputs and outputs are what callers depend on, and
- the test still passes after any refactor that keeps those inputs and
  outputs the same.

Use parameterised tests (`[Theory]` / `it.each`) with literal inputs and
outputs for the case table.
