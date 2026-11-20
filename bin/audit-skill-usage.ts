import { Database } from "bun:sqlite";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { createInterface } from "node:readline";
import { installedSkills } from "./installed-skills.ts";

const PROVIDERS = ["codex", "claude", "opencode", "t3"];
type RecordValue = Record<string, unknown>;
type Observation = {
  provider: string;
  session: string;
  skill: string;
  time: string;
  kind: string;
  source: string;
  event: string;
};
type Source = { status: "available" | "missing" | "partial"; records: number };
type Counts = { sessions: number; providers: Record<string, number> };
type Options = {
  home: string;
  sources: string[];
  since: string | null;
  until: string | null;
  excludeCwds: string[];
  groups: Map<string, Set<string>>;
  format: "table" | "json";
  evidence: boolean;
  output?: string;
  verbose: boolean;
  includeUninstalled: boolean;
  skillsDirs: string[];
  top: number | null;
  last: number | null;
};
function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function record(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function key(...parts: string[]): string {
  return JSON.stringify(parts);
}
function rows(db: Database, sql: string): IterableIterator<RecordValue> {
  return db.query<RecordValue, []>(sql).iterate();
}
function providerName(value: unknown): string {
  return value === "codex_latest"
    ? "codex"
    : value === "claudeAgent"
      ? "claude"
      : text(value);
}
function skillName(value: string): string | undefined {
  let name = value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\/+$/, "");
  if (basename(name).toLowerCase() === "skill.md")
    name = basename(dirname(name));
  else if (name.includes("/")) name = basename(name);
  name = name.split(":").at(-1) ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) && name !== "."
    ? name
    : undefined;
}
function canonical(path: string): string {
  const absolute = resolve(
    path.startsWith("~/") ? join(homedir(), path.slice(2)) : path,
  );
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute
    ? absolute
    : join(canonical(parent), basename(absolute));
}
function expandedSkills(value: unknown): Set<string> {
  const result = new Set<string>();
  for (const match of text(value).matchAll(
    /Base directory for this skill:\s*([^\s<>]+)/g,
  )) {
    const name = skillName(match[1]);
    if (name) result.add(name);
  }
  return result;
}

// Recognize literal reads without evaluating shell syntax or executing commands.
function shellTokens(command: string): string[] | undefined {
  const tokens: string[] = [];
  let word = "",
    quote = "",
    active = false;
  const emit = () => {
    if (active) tokens.push(word);
    word = "";
    active = false;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = "";
      else if (
        char === "\\" &&
        quote === '"' &&
        ['"', "\\", "$", "`"].includes(command[i + 1])
      )
        word += command[++i];
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      active = true;
    } else if (char === "\\") {
      if (i + 1 === command.length) return undefined;
      word += command[++i];
      active = true;
    } else if (char === "#") {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
    } else if (" \t\r".includes(char)) emit();
    else if (";&|<>\n".includes(char)) {
      emit();
      let punctuation = char;
      while (char !== "\n" && command[i + 1] === char)
        punctuation += command[++i];
      tokens.push(punctuation);
    } else {
      word += char;
      active = true;
    }
  }
  if (quote) return undefined;
  emit();
  return tokens;
}
function shellSkills(value: unknown, cwd?: string, depth = 0): Set<string> {
  const command = text(value),
    found = new Set<string>();
  if (!command.toLowerCase().includes("skill.md") || depth > 16) return found;
  const tokens = shellTokens(command.split("<<", 1)[0]);
  if (!tokens) return found;
  let directory = cwd,
    words: string[] = [];
  const consume = () => {
    while (
      words.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) ||
        ["env", "command"].includes(words[0]))
    )
      words.shift();
    if (!words.length) return;
    const program = basename(words[0]);
    if (
      ["sh", "bash", "zsh"].includes(program) &&
      words.length >= 3 &&
      words[1].includes("c")
    ) {
      for (const name of shellSkills(words[2], directory, depth + 1))
        found.add(name);
    } else if (program === "cd" && words.length === 2) {
      const target = words[1].startsWith("~/")
        ? join(homedir(), words[1].slice(2))
        : words[1];
      directory =
        isAbsolute(target) || !directory ? target : resolve(directory, target);
    } else if (
      ["cat", "head", "tail", "bat", "less", "more"].includes(program) ||
      (program === "sed" && words.includes("-n"))
    ) {
      for (let path of words.slice(1)) {
        if ([">", ">>", "<", "2>"].includes(path)) break;
        if (path.includes("$") || basename(path).toLowerCase() !== "skill.md")
          continue;
        if (!isAbsolute(path) && directory) path = resolve(directory, path);
        const name = skillName(path);
        if (name) found.add(name);
      }
    }
  };
  for (const token of [...tokens, ";"]) {
    if ([";", "&&", "||", "|", "&", "\n"].includes(token)) {
      consume();
      words = [];
    } else words.push(token);
  }
  return found;
}
function toolSkills(name: string, input: unknown, cwd?: string): Set<string> {
  const short = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      /* May be functions.exec JavaScript. */
    }
  }
  const args = record(input);
  if (["skill", "use_skill"].includes(short)) {
    const name = skillName(text(args.skill || args.name));
    return new Set(name ? [name] : []);
  }
  cwd = text(args.workdir || args.cwd) || cwd;
  if (["read", "read_file", "read_text_file", "view"].includes(short)) {
    let path = text(args.filePath || args.file_path || args.path);
    if (basename(path).toLowerCase() === "skill.md") {
      if (!isAbsolute(path) && cwd) path = resolve(cwd, path);
      const name = skillName(path);
      return new Set(name ? [name] : []);
    }
  }
  if (
    [
      "bash",
      "shell",
      "exec_command",
      "run_command",
      "command_execution",
    ].includes(short)
  )
    return shellSkills(args.cmd || args.command, cwd);
  const found = new Set<string>();
  if (["exec", "js"].includes(short) && typeof input === "string") {
    const pattern =
      /(?:\b(?:cmd|command)|"(?:cmd|command)")\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
    for (const match of input.matchAll(pattern)) {
      const quoted = match[1];
      let command: unknown;
      try {
        command = quoted.startsWith('"')
          ? JSON.parse(quoted)
          : quoted.slice(1, -1).replaceAll("\\'", "'").replaceAll("\\n", "\n");
      } catch {
        continue;
      }
      for (const name of shellSkills(command, cwd)) found.add(name);
    }
  }
  return found;
}
function failedResult(value: unknown): boolean {
  if (typeof value === "string") {
    try {
      return failedResult(JSON.parse(value));
    } catch {
      const match = value
        .slice(0, 1000)
        .match(/(?:Process exited with code|Exit code:)\s*(\d+)/);
      return !!match && match[1] !== "0";
    }
  }
  if (Array.isArray(value))
    return value.some((part) => failedResult(record(part).text));
  const result = record(value);
  return !!(result.isError || result.is_error || result.exit_code);
}

type Report = {
  schema_version: number;
  metric: string;
  filters: {
    since: string | null;
    until: string | null;
    include_uninstalled: boolean;
    top: number | null;
    last: number | null;
  };
  installed_skills: string[];
  matching_skills: number;
  observed_utc_range: string[];
  sessions_scanned: number;
  sessions_with_loads: number;
  skill_session_pairs: number;
  skills: (Counts & { skill: string })[];
  groups: (Counts & { group: string; members: string[] })[];
  sources: Record<string, Source>;
  errors: string[];
  evidence?: Observation[];
};
class Audit {
  private sessions = new Set<string>();
  private excluded = new Set<string>();
  private observations = new Map<string, Observation>();
  private toolSessions = new Map<string, Set<string>>();
  private sources: Record<string, Source> = {};
  private errors = new Set<string>();
  private excludeCwds: Set<string>;
  constructor(private options: Options) {
    this.excludeCwds = new Set(options.excludeCwds.map(canonical));
  }
  private session(provider: string, sid: string, cwd?: string) {
    this.sessions.add(key(provider, sid));
    if (cwd && this.excludeCwds.has(canonical(cwd)))
      this.excluded.add(key(provider, sid));
  }
  private add(
    provider: string,
    session: string,
    names: Set<string>,
    stamp: unknown,
    kind: string,
    source: string,
    event: string,
  ) {
    if (!names.size) return;
    let time: string;
    try {
      if (typeof stamp !== "string" && typeof stamp !== "number")
        throw new Error();
      const utc =
        typeof stamp === "string" && !/(Z|[+-]\d\d:\d\d)$/.test(stamp)
          ? stamp + "Z"
          : stamp;
      time = new Date(utc).toISOString().replace("Z", "+00:00");
    } catch {
      this.sources[source].status = "partial";
      this.errors.add(`${source}: invalid skill-evidence timestamp (${event})`);
      return;
    }
    const day = time.slice(0, 10);
    if (
      (this.options.since && day < this.options.since) ||
      (this.options.until && day > this.options.until)
    )
      return;
    for (const skill of names)
      this.observations.set(
        key(provider, session, skill, time, kind, source, event),
        { provider, session, skill, time, kind, source, event },
      );
  }
  private tool(
    provider: string,
    sid: string,
    name: string,
    args: unknown,
    stamp: unknown,
    source: string,
    event: string,
    cwd?: string,
  ) {
    if (event) {
      const id = key(provider, event),
        sessions = this.toolSessions.get(id) ?? new Set<string>();
      sessions.add(sid);
      this.toolSessions.set(id, sessions);
    }
    const kind = ["skill", "use_skill"].includes(
      name.split(".").at(-1)?.toLowerCase() ?? "",
    )
      ? "skill_call"
      : "manifest_read";
    this.add(
      provider,
      sid,
      toolSkills(name, args, cwd),
      stamp,
      kind,
      source,
      event,
    );
  }
  private begin(source: string, present: boolean) {
    this.sources[source] = {
      status: present ? "available" : "missing",
      records: 0,
    };
    if (present && this.options.verbose) console.error(`Scanning ${source}`);
  }
  private database(path: string, source: string, read: (db: Database) => void) {
    this.begin(source, existsSync(path));
    if (!existsSync(path)) return;
    let db: Database | undefined;
    try {
      db = new Database(path, { readonly: true, create: false });
      db.run("PRAGMA query_only=ON");
      db.run("BEGIN");
      read(db);
    } catch (error) {
      this.sources[source].status = "partial";
      this.errors.add(
        `${source}: ${error instanceof Error ? error.message : "database error"}`,
      );
    } finally {
      db?.close();
    }
  }
  private *files(root: string): Generator<string> {
    if (!existsSync(root)) return;
    for (const entry of readdirSync(root, { withFileTypes: true }).sort(
      (a, b) => compare(a.name, b.name),
    )) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) yield* this.files(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
    }
  }
  private async *jsonl(
    path: string,
    source: string,
  ): AsyncGenerator<RecordValue> {
    const input = createReadStream(path, { encoding: "utf8" }),
      lines = createInterface({ input, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of lines) {
        lineNumber++;
        try {
          const item: unknown = JSON.parse(line);
          if (!item || Array.isArray(item) || typeof item !== "object")
            throw new Error();
          this.sources[source].records++;
          yield record(item);
        } catch {
          this.sources[source].status = "partial";
          this.errors.add(
            `${source}: ${relative(this.options.home, path)}:${lineNumber}: invalid JSONL object`,
          );
        }
      }
    } finally {
      lines.close();
      input.destroy();
    }
  }

  async scanCodex() {
    const source = "codex_jsonl",
      roots = [".codex/sessions", ".codex/archived_sessions"].map((p) =>
        join(this.options.home, p),
      );
    this.begin(source, roots.some(existsSync));
    for (const path of roots
      .flatMap((root) => [...this.files(root)])
      .sort(compare)) {
      let sid = basename(path, ".jsonl"),
        cwd: string | undefined;
      const calls = new Map<string, { payload: RecordValue; stamp: unknown }>(),
        failures = new Map<string, boolean>();
      for await (const item of this.jsonl(path, source)) {
        const p = record(item.payload),
          call = text(p.call_id || p.id);
        if (item.type === "session_meta") {
          sid = text(p.id || p.session_id, sid);
          cwd = text(p.cwd) || undefined;
        } else if (item.type === "response_item") {
          if (["function_call", "custom_tool_call"].includes(text(p.type)))
            calls.set(call, { payload: p, stamp: item.timestamp });
          else if (
            ["function_call_output", "custom_tool_call_output"].includes(
              text(p.type),
            )
          )
            failures.set(call, failedResult(p.output));
        }
      }
      this.session("codex", sid, cwd);
      for (const [call, { payload: p, stamp }] of calls)
        if (failures.get(call) === false)
          this.tool(
            "codex",
            sid,
            text(p.name),
            p.arguments ?? p.input,
            stamp,
            source,
            call,
            cwd,
          );
    }
    this.database(
      join(this.options.home, ".codex/thread_history_1.sqlite"),
      "codex_history",
      (db) => {
        for (const row of rows(
          db,
          "SELECT DISTINCT thread_id FROM thread_items",
        ))
          this.session("codex", text(row.thread_id));
        for (const row of rows(
          db,
          "SELECT thread_id,created_at_ms,item_json FROM thread_items WHERE item_type='commandExecution'",
        )) {
          this.sources.codex_history.records++;
          const item = record(JSON.parse(text(row.item_json))),
            cwd = text(item.cwd) || undefined;
          this.session("codex", text(row.thread_id), cwd);
          if (item.status !== "completed" || item.exitCode) continue;
          this.tool(
            "codex",
            text(row.thread_id),
            "exec_command",
            { command: item.command },
            row.created_at_ms,
            "codex_history",
            text(item.id),
            cwd,
          );
        }
      },
    );
  }
  async scanClaude() {
    const source = "claude_jsonl",
      root = join(this.options.home, ".claude/projects");
    this.begin(source, existsSync(root));
    for (const path of this.files(root)) {
      let sid = basename(path, ".jsonl"),
        cwd: string | undefined;
      const calls = new Map<string, { part: RecordValue; stamp: unknown }>(),
        failed = new Set<string>();
      const expansions: {
        names: Set<string>;
        stamp: unknown;
        event: string;
      }[] = [];
      for await (const item of this.jsonl(path, source)) {
        sid = text(item.agentId || item.sessionId, sid);
        cwd = text(item.cwd) || cwd;
        const content = record(item.message).content;
        for (const value of typeof content === "string"
          ? [{ type: "text", text: content }]
          : array(content)) {
          const part = record(value);
          if (item.type === "assistant" && part.type === "tool_use")
            calls.set(text(part.id), { part, stamp: item.timestamp });
          else if (item.type === "user") {
            if (part.type === "tool_result" && part.is_error)
              failed.add(text(part.tool_use_id));
            else if (part.type === "text")
              expansions.push({
                names: expandedSkills(part.text),
                stamp: item.timestamp,
                event: text(item.uuid, basename(path, ".jsonl")),
              });
          }
        }
      }
      this.session("claude", sid, cwd);
      for (const [call, { part, stamp }] of calls)
        if (!failed.has(call))
          this.tool(
            "claude",
            sid,
            text(part.name),
            part.input,
            stamp,
            source,
            call,
            cwd,
          );
      for (const expansion of expansions)
        this.add(
          "claude",
          sid,
          expansion.names,
          expansion.stamp,
          "expanded_prompt",
          source,
          expansion.event,
        );
    }
  }
  scanOpencode() {
    this.database(
      join(this.options.home, ".local/share/opencode/opencode.db"),
      "opencode_db",
      (db) => {
        const tables = new Set(
          [
            ...rows(db, "SELECT name FROM sqlite_master WHERE type='table'"),
          ].map((row) => text(row.name)),
        );
        if (!tables.has("part") && !tables.has("session_message"))
          throw new Error("no supported OpenCode history tables");
        const directories = new Map<string, string>();
        for (const table of ["session", "session_v2"])
          if (tables.has(table)) {
            for (const row of rows(db, `SELECT id,directory FROM ${table}`)) {
              this.session("opencode", text(row.id), text(row.directory));
              directories.set(text(row.id), text(row.directory));
            }
          }
        const queries: string[] = [];
        if (tables.has("part"))
          queries.push(`SELECT session_id,message_id AS mid,json_extract(data,'$.callID') AS call,
        json_extract(data,'$.tool') AS name,json_extract(data,'$.state.status') AS status,
        json_extract(data,'$.state.input') AS args,time_created AS stamp FROM part WHERE json_extract(data,'$.type')='tool'`);
        if (tables.has("session_message"))
          queries.push(`SELECT m.session_id,m.id AS mid,json_extract(t.value,'$.id') AS call,
        json_extract(t.value,'$.name') AS name,json_extract(t.value,'$.state.status') AS status,
        json_extract(t.value,'$.state.input') AS args,m.time_created AS stamp
        FROM session_message m,json_each(m.data,'$.content') t WHERE m.type='assistant' AND json_extract(t.value,'$.type')='tool'`);
        for (const query of queries)
          for (const row of rows(db, query)) {
            this.sources.opencode_db.records++;
            const sid = text(row.session_id);
            this.session("opencode", sid, directories.get(sid));
            if (row.status === "completed")
              this.tool(
                "opencode",
                sid,
                text(row.name),
                row.args ? JSON.parse(text(row.args)) : {},
                row.stamp,
                "opencode_db",
                text(row.call || row.mid),
                directories.get(sid),
              );
          }
        const expansions: string[] = [];
        if (tables.has("part") && tables.has("message"))
          expansions.push(`SELECT p.session_id,p.id,p.time_created AS stamp,json_extract(p.data,'$.text') AS text
        FROM part p JOIN message m ON m.id=p.message_id WHERE json_extract(m.data,'$.role')='user'
        AND json_extract(p.data,'$.type')='text' AND p.data LIKE '%Base directory for this skill:%'`);
        if (tables.has("session_message"))
          expansions.push(`SELECT session_id,id,time_created AS stamp,json_extract(data,'$.text') AS text
        FROM session_message WHERE type IN ('user','synthetic') AND data LIKE '%Base directory for this skill:%'`);
        for (const query of expansions)
          for (const row of rows(db, query)) {
            this.sources.opencode_db.records++;
            const sid = text(row.session_id);
            this.session("opencode", sid, directories.get(sid));
            this.add(
              "opencode",
              sid,
              expandedSkills(row.text),
              row.stamp,
              "expanded_prompt",
              "opencode_db",
              text(row.id),
            );
          }
      },
    );
  }
  scanT3() {
    this.database(
      join(this.options.home, ".t3/userdata/statev2.sqlite"),
      "t3_history",
      (db) => {
        const mapping = new Map<string, { provider: string; sid: string }>();
        for (const row of rows(
          db,
          "SELECT provider_thread_id,payload_json FROM orchestration_v2_projection_provider_threads",
        )) {
          const item = record(JSON.parse(text(row.payload_json))),
            ref = record(item.nativeThreadRef);
          if (ref.nativeId)
            mapping.set(text(row.provider_thread_id), {
              provider: providerName(item.driver || ref.driver),
              sid: text(ref.nativeId),
            });
        }
        const query = `SELECT thread_id,provider_thread_id,payload_json FROM orchestration_v2_projection_turn_items WHERE type IN ('command_execution','dynamic_tool')`;
        for (const row of rows(db, query)) {
          this.sources.t3_history.records++;
          const item = record(JSON.parse(text(row.payload_json)));
          if (
            item.status !== "completed" ||
            item.exitCode ||
            failedResult(item.output)
          )
            continue;
          const ref = record(item.nativeItemRef),
            thread = text(row.thread_id);
          let { provider, sid } = mapping.get(text(row.provider_thread_id)) ?? {
            provider: providerName(ref.driver) || "t3",
            sid: thread,
          };
          const candidates = this.toolSessions.get(
            key(provider, text(ref.nativeId)),
          );
          if (candidates?.size === 1) sid = [...candidates][0];
          else if (provider === "claude") {
            const match = decodeURIComponent(thread).match(/:(a[0-9a-f]+)$/);
            if (match) sid = match[1];
          }
          for (const imported of PROVIDERS.slice(0, -1))
            if (thread.startsWith(`import:${imported}:`)) {
              provider = imported;
              sid = thread.slice(`import:${imported}:`.length);
            }
          this.session(provider, sid);
          const name =
            item.type === "command_execution"
              ? "command_execution"
              : text(item.toolName);
          this.tool(
            provider,
            sid,
            name,
            name === "command_execution" ? { command: item.input } : item.input,
            item.startedAt || item.updatedAt,
            "t3_history",
            text(ref.nativeId || item.id),
          );
        }
      },
    );
  }
  report(): Report {
    const inventory = installedSkills(
      this.options.home,
      this.options.skillsDirs,
    );
    for (const error of inventory.errors) this.errors.add(error);
    const fields: (keyof Observation)[] = [
      "provider",
      "session",
      "skill",
      "time",
      "kind",
      "source",
      "event",
    ];
    const observations = [...this.observations.values()]
      .filter(
        (o) =>
          !this.excluded.has(key(o.provider, o.session)) &&
          (this.options.includeUninstalled || inventory.skills.has(o.skill)),
      )
      .sort((a, b) => {
        for (const field of fields) {
          const order = compare(a[field], b[field]);
          if (order) return order;
        }
        return 0;
      });
    const pairs = new Map(
      observations.map((o) => [key(o.provider, o.session, o.skill), o]),
    );
    const count = (items: Iterable<Observation>): Counts => {
      const providers: Record<string, number> = {};
      let sessions = 0;
      for (const item of items) {
        sessions++;
        providers[item.provider] = (providers[item.provider] ?? 0) + 1;
      }
      return { sessions, providers };
    };
    const bySkill = new Map<string, Observation[]>();
    for (const skill of inventory.skills) bySkill.set(skill, []);
    for (const item of pairs.values()) {
      const list = bySkill.get(item.skill) ?? [];
      list.push(item);
      bySkill.set(item.skill, list);
    }
    const ranked = [...bySkill]
      .map(([skill, items]) => ({ skill, ...count(items) }))
      .sort(
        (a, b) =>
          (this.options.last === null
            ? b.sessions - a.sessions
            : a.sessions - b.sessions) || compare(a.skill, b.skill),
      );
    const skills = ranked.slice(
      0,
      this.options.top ?? this.options.last ?? ranked.length,
    );
    const shown = new Set(skills.map((row) => row.skill));
    const groups = [...this.options.groups]
      .sort(([a], [b]) => compare(a, b))
      .map(([group, members]) => {
        const distinct = new Map(
          [...pairs.values()]
            .filter((o) => members.has(o.skill))
            .map((o) => [key(o.provider, o.session), o]),
        );
        return {
          group,
          members: [...members].sort(compare),
          ...count(distinct.values()),
        };
      });
    const times = observations.map((o) => o.time).sort(compare);
    return {
      schema_version: 1,
      metric:
        "sessions with observed skill loads; once per skill per provider session",
      filters: {
        since: this.options.since,
        until: this.options.until,
        include_uninstalled: this.options.includeUninstalled,
        top: this.options.top,
        last: this.options.last,
      },
      installed_skills: [...inventory.skills].sort(compare),
      matching_skills: ranked.length,
      observed_utc_range: times.length
        ? [times[0], times[times.length - 1]]
        : [],
      sessions_scanned: [...this.sessions].filter((s) => !this.excluded.has(s))
        .length,
      sessions_with_loads: new Set(
        [...pairs.values()].map((o) => key(o.provider, o.session)),
      ).size,
      skill_session_pairs: pairs.size,
      skills,
      groups,
      sources: this.sources,
      errors: [...this.errors].sort(compare),
      ...(this.options.evidence
        ? { evidence: observations.filter((row) => shown.has(row.skill)) }
        : {}),
    };
  }
}

class ArgumentError extends Error {}
const HELP = `Audit saved skill usage. All source databases are read-only.

Usage: skills usage [options]
  --home PATH           History root (default: current user's home)
  --sources PROVIDER... codex, claude, opencode, t3 (default: all)
  --since YYYY-MM-DD    Inclusive UTC start date
  --until YYYY-MM-DD    Inclusive UTC end date
  --top N               Show the N most-used skills
  --last N              Show the N least-used skills, including zero usage
  --include-uninstalled Include historical skills no longer installed
  --skills-dir PATH     Also discover skills in this directory; repeatable
  --exclude-cwd PATH    Exclude whole sessions; repeatable
  --group NAME=A,B      Count unique sessions across member skills; repeatable
  --format table|json   Output format (default: table)
  --evidence            Include event identifiers and timestamps in JSON
  --output PATH         Atomically write a report instead of stdout
  --verbose             Print source progress to stderr
  --help                Show this help
`;
function parseOptions(rawArgs: string[]): Options {
  const args = rawArgs.flatMap((arg) => {
    const equals = arg.indexOf("=");
    return arg.startsWith("--") && equals > 0
      ? [arg.slice(0, equals), arg.slice(equals + 1)]
      : [arg];
  });
  const options: Options = {
    home: homedir(),
    sources: [...PROVIDERS],
    since: null,
    until: null,
    excludeCwds: [],
    groups: new Map(),
    format: "table",
    evidence: false,
    verbose: false,
    includeUninstalled: false,
    skillsDirs: [],
    top: null,
    last: null,
  };
  const value = (index: number): string => {
    if (!args[index + 1] || args[index + 1].startsWith("--"))
      throw new ArgumentError(`${args[index]} requires a value`);
    return args[index + 1];
  };
  for (let i = 0; i < args.length; i++)
    switch (args[i]) {
      case "--home":
        options.home = canonical(value(i++));
        break;
      case "--since":
      case "--until": {
        const flag = args[i],
          day = value(i++);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(Date.parse(day)) ||
          new Date(day).toISOString().slice(0, 10) !== day
        )
          throw new ArgumentError("expected YYYY-MM-DD");
        if (flag === "--since") options.since = day;
        else options.until = day;
        break;
      }
      case "--sources": {
        options.sources = [];
        while (args[i + 1] && !args[i + 1].startsWith("--"))
          options.sources.push(args[++i]);
        if (
          !options.sources.length ||
          options.sources.some((s) => !PROVIDERS.includes(s))
        )
          throw new ArgumentError(
            "--sources expects codex, claude, opencode, or t3",
          );
        break;
      }
      case "--exclude-cwd":
        options.excludeCwds.push(value(i++));
        break;
      case "--skills-dir":
        options.skillsDirs.push(canonical(value(i++)));
        break;
      case "--include-uninstalled":
        options.includeUninstalled = true;
        break;
      case "--top":
      case "--last": {
        const flag = args[i],
          raw = value(i++),
          count = Number(raw);
        if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(count))
          throw new ArgumentError(`${flag} expects a positive integer`);
        if (flag === "--top") options.top = count;
        else options.last = count;
        break;
      }
      case "--format": {
        const format = value(i++);
        if (format !== "table" && format !== "json")
          throw new ArgumentError("--format expects table or json");
        options.format = format;
        break;
      }
      case "--group": {
        const definition = value(i++),
          equals = definition.indexOf("="),
          name = definition.slice(0, equals),
          members = definition.slice(equals + 1).split(",");
        if (
          equals < 1 ||
          !skillName(name) ||
          members.some((m) => !skillName(m))
        )
          throw new ArgumentError("--group expects NAME=SKILL,SKILL");
        if (options.groups.has(name))
          throw new ArgumentError(`duplicate group: ${name}`);
        options.groups.set(
          name,
          new Set(members.map((m) => skillName(m) ?? m)),
        );
        break;
      }
      case "--evidence":
        options.evidence = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--output":
        options.output = canonical(value(i++));
        break;
      default:
        throw new ArgumentError(`unknown argument: ${args[i]}`);
    }
  if (options.since && options.until && options.since > options.until)
    throw new ArgumentError("--since must be on or before --until");
  if (options.top !== null && options.last !== null)
    throw new ArgumentError("--top and --last cannot be combined");
  if (options.output) {
    const directories = [
      ".codex/sessions",
      ".codex/archived_sessions",
      ".claude/projects",
    ].map((p) => canonical(join(options.home, p)));
    const databases = [
      ".codex/thread_history_1.sqlite",
      ".local/share/opencode/opencode.db",
      ".t3/userdata/statev2.sqlite",
    ];
    const files = databases
      .flatMap((p) => [p, p + "-wal", p + "-shm"])
      .map((p) => canonical(join(options.home, p)));
    if (
      files.includes(options.output) ||
      directories.some(
        (p) => options.output === p || options.output?.startsWith(p + "/"),
      )
    )
      throw new ArgumentError(
        "--output must be outside the history source files and directories",
      );
  }
  return options;
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([k, v]) => [k, stableValue(v)]),
    );
  return value;
}
function table(report: Report): string {
  const providers = [
    ...new Set(report.skills.flatMap((s) => Object.keys(s.providers))),
  ].sort(compare);
  const labels: Record<string, string> = {
    codex: "Codex",
    claude: "Claude",
    opencode: "OpenCode",
    t3: "T3",
  };
  const showInstalled = report.filters.include_uninstalled;
  const installed = new Set(report.installed_skills);
  const headers = [
    "Skill",
    "Sessions",
    ...(showInstalled ? ["Installed"] : []),
    ...providers.map((p) => labels[p] ?? p),
  ];
  const values = report.skills.map((row) => [
    row.skill,
    String(row.sessions),
    ...(showInstalled ? [installed.has(row.skill) ? "yes" : "no"] : []),
    ...providers.map((p) => String(row.providers[p] ?? 0)),
  ]);
  const widths = headers.map((label, column) =>
    Math.max(label.length, ...values.map((row) => row[column].length)),
  );
  const border = (left: string, middle: string, right: string) =>
    left + widths.map((width) => "─".repeat(width + 2)).join(middle) + right;
  const renderRow = (row: string[]) =>
    "│ " +
    row
      .map((value, column) =>
        column === 0 || (showInstalled && column === 2)
          ? value.padEnd(widths[column])
          : value.padStart(widths[column]),
      )
      .join(" │ ") +
    " │";
  const lines = [
    `Showing ${report.skills.length} of ${report.matching_skills} matching skills; ${report.skill_session_pairs} skill/session pairs; ${report.sessions_scanned} sessions scanned.`,
    "Counts are observed usage sessions, not individual invocations.",
    "",
    border("┌", "┬", "┐"),
    renderRow(headers),
    border("├", "┼", "┤"),
    ...values.map(renderRow),
    border("└", "┴", "┘"),
  ];
  if (!report.skills.length) lines.push("No skills match the current filters.");
  if (report.groups.length) {
    lines.push("", "Groups (unique sessions across member skills):");
    for (const g of report.groups)
      lines.push(`${g.group}: ${g.sessions} (${g.members.join(", ")})`);
  }
  lines.push(
    "",
    "Sources: " +
      Object.entries(report.sources)
        .sort(([a], [b]) => compare(a, b))
        .map(([n, s]) => `${n}=${s.status}`)
        .join(", "),
  );
  if (report.errors.length) lines.push("", "Errors:", ...report.errors);
  return lines.join("\n") + "\n";
}
async function main(): Promise<number> {
  if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const options = parseOptions(process.argv.slice(2)),
    audit = new Audit(options);
  if (options.sources.includes("codex")) await audit.scanCodex();
  if (options.sources.includes("claude")) await audit.scanClaude();
  if (options.sources.includes("opencode")) audit.scanOpencode();
  if (options.sources.includes("t3")) audit.scanT3();
  const report = audit.report();
  if (Object.values(report.sources).every((s) => s.status === "missing"))
    report.errors.push("No supported history sources found");
  const rendered =
    options.format === "json"
      ? JSON.stringify(stableValue(report), null, 2) + "\n"
      : table(report);
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    const temporary = mkdtempSync(
      join(dirname(options.output), ".skill-audit-"),
    );
    try {
      const file = join(temporary, "report");
      writeFileSync(file, rendered, { mode: 0o600 });
      renameSync(file, options.output);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  } else process.stdout.write(rendered);
  return report.errors.length ? 1 : 0;
}
try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    `skills usage: ${error instanceof Error ? error.message : "audit failed"}`,
  );
  process.exitCode = error instanceof ArgumentError ? 2 : 1;
}
