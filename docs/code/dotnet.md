### .NET C#  

- Prefer primary constructors
- Always try to keep changes to existing code as minimal as possible.
- Introduce new concepts only when necessary.

#### Testing

- Always use AAA comments in tests (when there is no code for either Arrange, Act or Assert simply omit the comment).
- Use assertion scopes and chain assertions (e.g. Should().ContainSingle().Which....)
- Follow the `writing-tests` skill: assert observable behaviour, literal expected values, no mocks of our own code.
- Prefer `WebApplicationFactory<Program>` + Testcontainers over unit tests with mocks. Fake only external boundaries (WireMock.Net for third-party HTTP, `FakeTimeProvider` for time); never Moq our own classes.
- Create the system under test and shared fakes in the constructor (pascal case readonly fields with _ prefix) and re-use them in the tests.
- AutoFixture is fine for filler data; every value a test asserts on must be a literal set in the test.
- If you want to run tests using the Testcontainers library, set DOCKER_HOST=unix:///run/user/1000/podman/podman.sock, TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/run/user/1000/podman/podman.sock, TESTCONTAINERS_RYUK_DISABLED=true, and start the socket with systemctl --user start podman.socket.
