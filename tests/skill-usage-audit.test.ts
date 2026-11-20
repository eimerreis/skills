import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const COMMAND = resolve(import.meta.dir, "../bin/audit-skill-usage");
const OCTOBER_1 = 1790812800000,
  OCTOBER_2 = 1790899200000;
let home: string;
let databases: Database[];
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "skill-audit-test-"));
  databases = [];
});
afterEach(() => {
  for (const db of databases) db.close();
  rmSync(home, { recursive: true, force: true });
});

function run(...args: string[]) {
  return spawnSync(
    COMMAND,
    ["--home", home, "--format", "json", "--include-uninstalled", ...args],
    {
      encoding: "utf8",
    },
  );
}
function installedReport(...args: string[]): Report {
  const result = spawnSync(
    COMMAND,
    ["--home", home, "--sources", "opencode", "--format", "json", ...args],
    { encoding: "utf8" },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
function installSkill(
  name: string,
  root = join(home, ".agents/skills"),
): string {
  const path = join(root, name, "SKILL.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\nname: ${name}\ndescription: Test fixture.\n---\n`);
  return path;
}
type Report = {
  matching_skills: number;
  installed_skills: string[];
  sessions_scanned: number;
  skill_session_pairs: number;
  skills: {
    skill: string;
    sessions: number;
    providers: Record<string, number>;
  }[];
  groups: {
    group: string;
    members: string[];
    sessions: number;
    providers: Record<string, number>;
  }[];
  sources: Record<string, { status: string }>;
  errors: string[];
};
function report(...args: string[]): Report {
  const result = run(...args);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
function database(path: string, schema: string) {
  const file = join(home, path);
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.run(schema);
  databases.push(db);
  return db;
}
function opencode() {
  return database(
    ".local/share/opencode/opencode.db",
    `
    CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT);
    CREATE TABLE session_v2(id TEXT PRIMARY KEY,directory TEXT);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);
    CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_created INTEGER,data TEXT);
    CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,time_created INTEGER,data TEXT);
  `,
  );
}
function tool(
  db: Database,
  sid: string,
  call: string,
  name: string,
  input: unknown,
  options: { status?: string; version?: number; stamp?: string | number } = {},
) {
  const { status = "completed", version = 1, stamp = OCTOBER_1 } = options;
  if (version === 1)
    db.query("INSERT INTO part VALUES(?,?,?,?,?)").run(
      call,
      "message-" + call,
      sid,
      stamp,
      JSON.stringify({
        type: "tool",
        callID: call,
        tool: name,
        state: { status, input },
      }),
    );
  else
    db.query("INSERT INTO session_message VALUES(?,?,?,?,?)").run(
      "message-" + call,
      sid,
      "assistant",
      stamp,
      JSON.stringify({
        content: [{ type: "tool", id: call, name, state: { status, input } }],
      }),
    );
}
function jsonl(path: string, items: unknown[]) {
  const file = join(home, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    items.map((item) => JSON.stringify(item) + "\n").join(""),
  );
  return file;
}
function codexCall(call: string, command: string, code = 0) {
  return [
    {
      type: "response_item",
      timestamp: "2026-10-01T10:00:00Z",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: call,
        arguments: JSON.stringify({ cmd: command }),
      },
    },
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: call,
        output: `Process exited with code ${code}`,
      },
    },
  ];
}

test("OpenCode migrations, repeated reads, and wrappers count unique sessions", () => {
  const db = opencode();
  db.run(
    "INSERT INTO session VALUES('one','/repo'); INSERT INTO session_v2 VALUES('one','/repo'); INSERT INTO session_v2 VALUES('two','/repo');",
  );
  tool(db, "one", "a", "skill", { name: "lean-grill" });
  tool(db, "one", "a", "skill", { name: "lean-grill" }, { version: 2 });
  tool(db, "one", "b", "read", { filePath: "/skills/lean-grill/SKILL.md" });
  tool(db, "two", "c", "skill", { name: "lean-grill" }, { version: 2 });
  tool(db, "two", "d", "skill", { name: "failed-skill" }, { status: "error" });
  tool(
    db,
    "two",
    "e",
    "skill",
    { name: "pending-skill" },
    { status: "running" },
  );
  const insert = db.query("INSERT INTO session_message VALUES(?,?,?,?,?)");
  insert.run(
    "expanded",
    "two",
    "user",
    OCTOBER_1,
    JSON.stringify({
      text: "Run lean grill.\nBase directory for this skill: /skills/lean-grill-with-docs\n",
    }),
  );
  insert.run(
    "prose",
    "two",
    "user",
    OCTOBER_1,
    JSON.stringify({ text: "I like the unused-skill skill" }),
  );
  const result = report(
    "--sources",
    "opencode",
    "--group",
    "lean=lean-grill,lean-grill-with-docs",
  );
  expect(result.sessions_scanned).toBe(2);
  expect(result.skills).toEqual([
    { skill: "lean-grill", sessions: 2, providers: { opencode: 2 } },
    { skill: "lean-grill-with-docs", sessions: 1, providers: { opencode: 1 } },
  ]);
  expect(result.groups).toEqual([
    {
      group: "lean",
      members: ["lean-grill", "lean-grill-with-docs"],
      sessions: 2,
      providers: { opencode: 2 },
    },
  ]);
});

test("Codex database and T3 imports are deduplicated with JSONL", () => {
  jsonl(".codex/sessions/one.jsonl", [
    { type: "session_meta", payload: { id: "native-one", cwd: "/repo" } },
    ...codexCall("one", "cat /skills/grilling/SKILL.md"),
    ...codexCall("two", "cat /skills/grilling/SKILL.md"),
    ...codexCall("failed", "cat /skills/failed/SKILL.md", 1),
    ...codexCall("prose", "printf 'cat /skills/not-a-read/SKILL.md'"),
    ...codexCall("write", "cat > /skills/not-a-load/SKILL.md"),
  ]);
  const codex = database(
    ".codex/thread_history_1.sqlite",
    "CREATE TABLE thread_items(thread_id TEXT,created_at_ms INTEGER,item_json TEXT,item_type TEXT);",
  );
  codex.query("INSERT INTO thread_items VALUES(?,?,?,?)").run(
    "native-one",
    OCTOBER_1,
    JSON.stringify({
      id: "exec-one",
      command: "/bin/zsh -lc 'cat /skills/grilling/SKILL.md'",
      status: "completed",
      cwd: "/repo",
    }),
    "commandExecution",
  );
  const t3 = database(
    ".t3/userdata/statev2.sqlite",
    `CREATE TABLE orchestration_v2_projection_provider_threads(provider_thread_id TEXT,payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_turn_items(thread_id TEXT,provider_thread_id TEXT,payload_json TEXT,type TEXT);`,
  );
  t3.query(
    "INSERT INTO orchestration_v2_projection_provider_threads VALUES(?,?)",
  ).run(
    "provider-one",
    JSON.stringify({
      driver: "codex",
      nativeThreadRef: { nativeId: "native-one" },
    }),
  );
  const insert = t3.query(
    "INSERT INTO orchestration_v2_projection_turn_items VALUES(?,?,?,?)",
  );
  insert.run(
    "app-one",
    "provider-one",
    JSON.stringify({
      id: "t3-one",
      type: "command_execution",
      status: "completed",
      input: "cat /skills/grilling/SKILL.md",
      startedAt: "2026-10-01T00:00:00Z",
    }),
    "command_execution",
  );
  insert.run(
    "app-one",
    "provider-one",
    JSON.stringify({
      id: "t3-failed",
      type: "dynamic_tool",
      status: "completed",
      toolName: "Skill",
      input: { skill: "failed-import" },
      output: { isError: true },
      startedAt: "2026-10-01T00:00:00Z",
    }),
    "dynamic_tool",
  );
  const result = report("--sources", "codex", "t3");
  expect(result.sessions_scanned).toBe(1);
  expect(result.skills).toEqual([
    { skill: "grilling", sessions: 1, providers: { codex: 1 } },
  ]);
});

test("Claude expanded prompts and explicit calls exclude failed calls", () => {
  jsonl(".claude/projects/repo/one.jsonl", [
    {
      type: "assistant",
      sessionId: "one",
      timestamp: "2026-10-01T12:00:00Z",
      message: {
        content: [
          {
            type: "tool_use",
            id: "a",
            name: "Skill",
            input: { skill: "grilling" },
          },
          {
            type: "tool_use",
            id: "b",
            name: "Skill",
            input: { skill: "failed" },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId: "one",
      timestamp: "2026-10-01T12:01:00Z",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "b", is_error: true },
          {
            type: "text",
            text: "Base directory for this skill: /skills/grill-me",
          },
        ],
      },
    },
  ]);
  const result = report(
    "--sources",
    "claude",
    "--group",
    "grill=grill-me,grilling",
  );
  expect(result.skill_session_pairs).toBe(2);
  expect(result.groups[0].sessions).toBe(1);
  expect(result.skills.map((row) => row.skill)).toEqual([
    "grill-me",
    "grilling",
  ]);
});

test("date filters use inclusive UTC days and exclusions remove whole sessions", () => {
  const db = opencode();
  db.run(
    "INSERT INTO session VALUES('one','/keep'); INSERT INTO session VALUES('two','/exclude');",
  );
  tool(db, "one", "a", "skill", { name: "first" });
  tool(db, "one", "b", "skill", { name: "second" }, { stamp: OCTOBER_2 });
  tool(db, "two", "c", "skill", { name: "excluded" });
  const result = report(
    "--sources",
    "opencode",
    "--since",
    "2026-10-01",
    "--until",
    "2026-10-01",
    "--exclude-cwd",
    "/exclude",
  );
  expect(result.skills).toEqual([
    { skill: "first", sessions: 1, providers: { opencode: 1 } },
  ]);
  expect(result.sessions_scanned).toBe(1);
});

test("shell reads resolve relative paths and nested functions.exec commands", () => {
  jsonl(".codex/sessions/one.jsonl", [
    { type: "session_meta", payload: { id: "one", cwd: "/skills/local" } },
    ...codexCall("one", "cat SKILL.md"),
    ...codexCall("two", "cd /skills/another && sed -n '1,30p' SKILL.md"),
    {
      type: "response_item",
      timestamp: "2026-10-01T00:00:00Z",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        call_id: "three",
        input:
          'text(await tools.exec_command({cmd:"cat /skills/nested/SKILL.md"}));',
      },
    },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "three",
        output: "Script completed",
      },
    },
  ]);
  expect(report("--sources", "codex").skills.map((row) => row.skill)).toEqual([
    "another",
    "local",
    "nested",
  ]);
});

test("identical inputs produce identical bytes and stable evidence", () => {
  const db = opencode();
  tool(db, "two", "b", "skill", { name: "beta" });
  tool(db, "one", "a", "skill", { name: "alpha" });
  const first = run("--sources", "opencode", "--evidence"),
    second = run("--sources", "opencode", "--evidence");
  expect(first.status).toBe(0);
  expect(second.status).toBe(0);
  expect(first.stdout).toBe(second.stdout);
  expect(first.stdout).not.toContain(home);
  expect(
    report("--sources", "opencode").skills.map((row) => row.skill),
  ).toEqual(["alpha", "beta"]);
});

test("partial history reports errors and missing providers remain visible", () => {
  jsonl(".claude/projects/repo/one.jsonl", [
    { type: "assistant", sessionId: "one", message: { content: [] } },
  ]);
  const file = join(home, ".codex/thread_history_1.sqlite");
  mkdirSync(dirname(file));
  writeFileSync(file, "not a database");
  const result = run();
  expect(result.status).toBe(1);
  const body: Report = JSON.parse(result.stdout);
  expect(body.sources.codex_history.status).toBe("partial");
  expect(body.sources.opencode_db.status).toBe("missing");
  expect(body.errors.length).toBe(1);
  expect(report("--sources", "claude").errors).toEqual([]);
});

test("malformed JSONL is reported without disclosing its contents", () => {
  writeFileSync(
    jsonl(".claude/projects/repo/one.jsonl", []),
    '{"private-incomplete-prompt":\n',
  );
  const result = run("--sources", "claude");
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).not.toContain(
    "private-incomplete-prompt",
  );
  expect(JSON.parse(result.stdout).errors.length).toBe(1);
});

test("requested output is written atomically while source data stays unchanged", () => {
  const db = opencode();
  tool(db, "one", "a", "skill", { name: "grilling" });
  db.close();
  const source = join(home, ".local/share/opencode/opencode.db"),
    before = readFileSync(source),
    target = join(home, "reports/audit.json");
  expect(existsSync(target)).toBe(false);
  const result = run("--sources", "opencode", "--output", target);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  expect(JSON.parse(readFileSync(target, "utf8")).skill_session_pairs).toBe(1);
  expect(readFileSync(source)).toEqual(before);
});

test("output cannot replace a history source", () => {
  const db = opencode();
  tool(db, "one", "a", "skill", { name: "grilling" });
  db.close();
  const source = join(home, ".local/share/opencode/opencode.db"),
    before = readFileSync(source);
  expect(run("--sources", "opencode", "--output", source).status).toBe(2);
  expect(readFileSync(source)).toEqual(before);
});

test("archived rollouts and active copies count once", () => {
  const items = [
    { type: "session_meta", payload: { id: "one", cwd: "/repo" } },
    ...codexCall("one", "cat /skills/grilling/SKILL.md"),
  ];
  jsonl(".codex/sessions/one.jsonl", items);
  jsonl(".codex/archived_sessions/one.jsonl", items);
  const result = report("--sources", "codex");
  expect(result.sessions_scanned).toBe(1);
  expect(result.skills).toEqual([
    { skill: "grilling", sessions: 1, providers: { codex: 1 } },
  ]);
});

test("malformed evidence timestamps produce a partial scan", () => {
  const db = opencode();
  tool(db, "one", "a", "skill", { name: "grilling" }, { stamp: "invalid" });
  const result = run("--sources", "opencode");
  expect(result.status).toBe(1);
  const body: Report = JSON.parse(result.stdout);
  expect(body.sources.opencode_db.status).toBe("partial");
  expect(body.skills).toEqual([]);
});

test("equals-form flags preserve CLI compatibility", () => {
  const db = opencode();
  tool(db, "one", "a", "skill", { name: "lean-grill" });
  const result = report(
    "--sources=opencode",
    "--format=json",
    "--since=2026-10-01",
  );
  expect(result.skills).toEqual([
    { skill: "lean-grill", sessions: 1, providers: { opencode: 1 } },
  ]);
});

test("invalid dates and malformed groups fail as argument errors", () => {
  for (const args of [
    ["--since", "2026-02-30"],
    ["--since", "2026-10-02", "--until", "2026-10-01"],
    ["--group", "missing-members="],
    ["--sources", "unknown"],
  ])
    expect(run(...args).status).toBe(2);
});

test("the Git usage alias forwards audit flags", () => {
  const db = opencode();
  tool(db, "one", "a", "skill", { name: "lean-grill" });
  const result = spawnSync(
    "git",
    [
      "-c",
      `alias.usage=!exec "${COMMAND}"`,
      "usage",
      "--home",
      home,
      "--sources",
      "opencode",
      "--include-uninstalled",
      "--format",
      "json",
    ],
    { cwd: resolve(import.meta.dir, ".."), encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  const body: Report = JSON.parse(result.stdout);
  expect(body.skills).toEqual([
    { skill: "lean-grill", sessions: 1, providers: { opencode: 1 } },
  ]);
});

test("default output includes installed unused skills and excludes removed history", () => {
  const db = opencode();
  installSkill("kept");
  installSkill("unused");
  tool(db, "one", "a", "skill", { name: "kept" });
  tool(db, "one", "b", "skill", { name: "removed" });
  const result = installedReport();
  expect(result.skills).toEqual([
    { skill: "kept", sessions: 1, providers: { opencode: 1 } },
    { skill: "unused", sessions: 0, providers: {} },
  ]);
  expect(result.installed_skills).toEqual(["kept", "unused"]);
  expect(result.matching_skills).toBe(2);
  expect(result.skill_session_pairs).toBe(1);
  expect(installedReport("--include-uninstalled").skills).toEqual([
    { skill: "kept", sessions: 1, providers: { opencode: 1 } },
    { skill: "removed", sessions: 1, providers: { opencode: 1 } },
    { skill: "unused", sessions: 0, providers: {} },
  ]);
});

test("top limits the most-used skills with deterministic tie breaking", () => {
  const db = opencode();
  for (const name of ["alpha", "beta", "gamma", "unused"]) installSkill(name);
  tool(db, "one", "a", "skill", { name: "alpha" });
  tool(db, "two", "b", "skill", { name: "alpha" });
  tool(db, "one", "c", "skill", { name: "gamma" });
  tool(db, "one", "d", "skill", { name: "beta" });
  const result = installedReport("--top=2");
  expect(result.skills).toEqual([
    { skill: "alpha", sessions: 2, providers: { opencode: 2 } },
    { skill: "beta", sessions: 1, providers: { opencode: 1 } },
  ]);
  expect(result.matching_skills).toBe(4);
  expect(result.skill_session_pairs).toBe(4);
});

test("last lists the least-used installed skills with never-used skills first", () => {
  const db = opencode();
  for (const name of ["alpha", "beta", "unused"]) installSkill(name);
  tool(db, "one", "a", "skill", { name: "alpha" });
  tool(db, "two", "b", "skill", { name: "alpha" });
  tool(db, "one", "c", "skill", { name: "beta" });
  expect(installedReport("--last", "2").skills).toEqual([
    { skill: "unused", sessions: 0, providers: {} },
    { skill: "beta", sessions: 1, providers: { opencode: 1 } },
  ]);
  expect(
    installedReport("--since", "2026-10-02", "--last", "2").skills,
  ).toEqual([
    { skill: "alpha", sessions: 0, providers: {} },
    { skill: "beta", sessions: 0, providers: {} },
  ]);
});

test("top and last require positive integers and cannot be combined", () => {
  for (const args of [
    ["--top", "0"],
    ["--last", "-1"],
    ["--top", "1.5"],
    ["--last", "9007199254740992"],
    ["--top", "2", "--last", "2"],
  ])
    expect(run(...args).status).toBe(2);
});

test("skill discovery follows symlinks once and accepts custom project roots", () => {
  opencode();
  const manifest = installSkill("shared");
  const claudeRoot = join(home, ".claude/skills");
  mkdirSync(claudeRoot, { recursive: true });
  symlinkSync(dirname(manifest), join(claudeRoot, "alias"));
  symlinkSync(join(home, ".agents/skills"), join(home, ".agents/skills/loop"));
  const project = join(home, "project/.agents/skills");
  installSkill("project-only", project);
  expect(installedReport().installed_skills).toEqual(["shared"]);
  expect(installedReport("--skills-dir", project).installed_skills).toEqual([
    "project-only",
    "shared",
  ]);
});

test("registered plugins are installed while stale unregistered cache entries are excluded", () => {
  opencode();
  const claudePlugin = join(home, ".claude/plugins/cache/example/1.0.0");
  installSkill("claude-plugin", join(claudePlugin, "skills"));
  installSkill(
    "stale-claude",
    join(home, ".claude/plugins/cache/stale/1/skills"),
  );
  writeFileSync(
    join(home, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({ plugins: { example: [{ installPath: claudePlugin }] } }),
  );
  const codexRoot = join(home, ".codex/plugins/cache/marketplace/example");
  installSkill("old-plugin-skill", join(codexRoot, "2.0.0/skills"));
  installSkill("codex-plugin", join(codexRoot, "10.0.0/skills"));
  installSkill(
    "stale-codex",
    join(home, ".codex/plugins/cache/marketplace/stale/1/skills"),
  );
  writeFileSync(
    join(home, ".codex/config.toml"),
    '[plugins."example@marketplace"]\nenabled = true\n',
  );
  expect(installedReport().installed_skills).toEqual([
    "claude-plugin",
    "codex-plugin",
  ]);
});

test("text output is a bordered table with aligned numeric columns", () => {
  const db = opencode();
  installSkill("alpha");
  tool(db, "one", "a", "skill", { name: "alpha" });
  tool(db, "two", "b", "skill", { name: "alpha" });
  const result = run("--format", "table");
  expect(result.status).toBe(0);
  expect(
    result.stdout.split("\n").filter((line) => /^[┌├│└]/.test(line)),
  ).toEqual([
    "┌───────┬──────────┬───────────┬──────────┐",
    "│ Skill │ Sessions │ Installed │ OpenCode │",
    "├───────┼──────────┼───────────┼──────────┤",
    "│ alpha │        2 │ yes       │        2 │",
    "└───────┴──────────┴───────────┴──────────┘",
  ]);
});
