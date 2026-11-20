import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

type Inventory = { skills: Set<string>; errors: string[] };
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** Discover installed manifests, following symlinks once and excluding unregistered caches. */
export function installedSkills(home: string, extraRoots: string[]): Inventory {
  const skills = new Set<string>(),
    errors: string[] = [],
    visited = new Set<string>();
  function visit(path: string) {
    if (!existsSync(path)) return;
    try {
      const physical = realpathSync(path);
      if (visited.has(physical)) return;
      visited.add(physical);
      if (!statSync(physical).isDirectory()) return;
      const entries = readdirSync(physical, { withFileTypes: true });
      const manifest = entries.find(
        (entry) => entry.name.toLowerCase() === "skill.md",
      );
      if (manifest) {
        const content = readFileSync(join(physical, manifest.name), "utf8");
        const frontmatter = content.match(
          /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
        )?.[1];
        const nameLine = frontmatter?.match(
          /^name:\s*(?:"([^"]+)"|'([^']+)'|([^#\r\n]+))/m,
        );
        const name =
          (
            nameLine?.[1] ??
            nameLine?.[2] ??
            nameLine?.[3] ??
            basename(physical)
          )
            .trim()
            .split(":")
            .at(-1) ?? "";
        if (/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) skills.add(name);
        return;
      }
      for (const entry of entries) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        if (entry.isDirectory() || entry.isSymbolicLink())
          visit(join(physical, entry.name));
      }
    } catch {
      errors.push(`installed_skills: could not read ${relative(home, path)}`);
    }
  }
  for (const root of [
    ".agents/skills",
    ".codex/skills",
    ".claude/skills",
    ".claude/plugins/synced",
    ".config/opencode/skills",
    ".config/opencode/skill",
    ".opencode/skills",
    ".opencode/skill",
  ])
    visit(join(home, root));
  for (const root of extraRoots) visit(resolve(root));

  const claudeRegistry = join(home, ".claude/plugins/installed_plugins.json");
  if (existsSync(claudeRegistry)) {
    try {
      const registry = object(JSON.parse(readFileSync(claudeRegistry, "utf8")));
      for (const entries of Object.values(object(registry.plugins))) {
        for (const entry of Array.isArray(entries) ? entries : []) {
          const path = object(entry).installPath;
          if (typeof path === "string") visit(join(path, "skills"));
        }
      }
    } catch {
      errors.push("installed_skills: could not read Claude plugin registry");
    }
  }

  const codexConfig = join(home, ".codex/config.toml");
  if (existsSync(codexConfig)) {
    try {
      const config = object(Bun.TOML.parse(readFileSync(codexConfig, "utf8")));
      for (const entry of Object.keys(object(config.plugins))) {
        const separator = entry.lastIndexOf("@");
        if (separator < 1) continue;
        const root = join(
          home,
          ".codex/plugins/cache",
          entry.slice(separator + 1),
          entry.slice(0, separator),
        );
        if (!existsSync(root)) continue;
        // Config names the installed plugin, not a version. Inspect its newest cached version.
        const versions = readdirSync(root, { withFileTypes: true })
          .filter((dir) => dir.isDirectory() && /^\d/.test(dir.name))
          .map((dir) => dir.name)
          .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
        const version = versions.at(-1);
        if (version) visit(join(root, version, "skills"));
      }
      const configuredSkills = object(config.skills).config;
      for (const entry of Array.isArray(configuredSkills)
        ? configuredSkills
        : []) {
        const path = object(entry).path;
        if (typeof path === "string") visit(dirname(path));
      }
    } catch {
      errors.push(
        "installed_skills: could not read Codex plugin configuration",
      );
    }
  }
  return { skills, errors: [...new Set(errors)].sort() };
}
