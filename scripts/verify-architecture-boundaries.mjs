import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HEADLESS_CORES = ["agent-core", "agent-runtime", "perception-core", "expression-core", "cognition-core", "extension-core"];
const INTERNAL_ALLOWLIST = {
  protocol: [],
  "extension-core": ["protocol"],
  "agent-core": ["protocol", "extension-core"],
  "perception-core": ["protocol", "extension-core"],
  "expression-core": ["protocol", "extension-core"],
  storage: ["protocol"],
  sdk: ["protocol", "extension-core"],
  "cognition-core": ["protocol", "extension-core", "agent-core"],
  "agent-runtime": ["protocol", "extension-core", "agent-core", "perception-core", "cognition-core", "expression-core"],
  gateway: ["protocol", "extension-core", "perception-core", "cognition-core", "expression-core", "storage"]
};
const WORKSPACE_PACKAGES = Object.keys(INTERNAL_ALLOWLIST);
const PLUGIN_ALLOWED_INTERNAL_DEPENDENCIES = new Set(["@ai0/protocol", "@ai0/sdk"]);
const AGENT_DOMAIN_TERMS = /D2_HOMEOSTASIS_AFFECT|SoulArchive|Lorebook|blush_level|user_eyes|local-persona-synthesizer/u;
const HOST_CONSOLE_FORBIDDEN_PLUGIN_DEPS = [
  "@assistant-ui/react",
  "streamdown",
  "@streamdown/",
  "eventsource-parser",
];
const HOST_DAEMON_FORBIDDEN_PLUGIN_DEPS = ["ai"];
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const WALK_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".pnpm-store",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const DESIGN_SYSTEM_DIRECTORIES = [
  "tokens",
  "primitives",
  "shell",
  "domain-visualizers",
  "composites",
];

// Headless core code must stay independent of UI runtimes, browser/desktop renderers,
// chat-platform SDKs, and Live2D/rendering SDKs. Prefix entries ending in "/"
// intentionally cover their entire package namespace.
const HEADLESS_FORBIDDEN_DEPENDENCIES = [
  "react",
  "react-dom",
  "next",
  "preact",
  "solid-js",
  "vue",
  "nuxt",
  "svelte",
  "sveltekit",
  "electron",
  "discord.js",
  "pixi.js",
  "three",
  "@angular/",
  "@discordjs/",
  "@live2d/",
  "@pixi/",
  "@sveltejs/",
  "live2d",
];

const violations = [];

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/") || ".";
}

function report(rule, message) {
  violations.push(`[${rule}] ${message}`);
}

async function pathInfo(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readJson(filePath, rule) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    report(rule, `Cannot read ${relativePath(filePath)}: ${error.message}`);
    return undefined;
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    report(rule, `Invalid JSON in ${relativePath(filePath)}: ${error.message}`);
    return undefined;
  }
}

async function walkFiles(root, options = {}) {
  const {
    include = () => true,
    ignoredDirectories = WALK_IGNORED_DIRECTORIES,
  } = options;
  const rootInfo = await pathInfo(root);
  if (!rootInfo?.isDirectory()) return [];

  const files = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) pending.push(absolutePath);
      } else if (entry.isFile() && include(absolutePath)) {
        files.push(absolutePath);
      }
      // Directory symlinks are deliberately not followed. This prevents a
      // workspace link (notably pnpm's node_modules links) from escaping the
      // repository scan or causing cycles.
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function dependencyEntries(packageJson) {
  const entries = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = packageJson?.[section];
    if (dependencies === undefined) continue;
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      entries.push({ section, name: undefined, invalid: true });
      continue;
    }
    for (const name of Object.keys(dependencies)) entries.push({ section, name });
  }
  return entries;
}

function matchesPackage(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function isForbiddenHeadlessDependency(name) {
  return HEADLESS_FORBIDDEN_DEPENDENCIES.some((forbidden) => {
    if (forbidden.endsWith("/")) return name.startsWith(forbidden);
    if (forbidden === "live2d") return name.toLowerCase().includes("live2d");
    return matchesPackage(name, forbidden);
  });
}

// Removes comments while retaining quoted strings. This keeps module
// specifiers available to the import scanner without treating commented-out
// imports as live dependencies.
function stripComments(source) {
  let result = "";
  let state = "code";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n" || character === "\r") {
        state = "code";
        result += character;
      } else {
        result += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += character === "\n" || character === "\r" ? character : " ";
      }
      continue;
    }

    if (state === "single-quote" || state === "double-quote" || state === "template") {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += character;
      if (character === "'") state = "single-quote";
      else if (character === '"') state = "double-quote";
      else if (character === "`") state = "template";
    }
  }

  return result;
}

// Masks comments and literal text while preserving executable template-literal
// expressions. It is intentionally separate from stripComments(): import
// scanning needs quoted module names, whereas call scanning must not mistake a
// documentation string such as "Date.now()" for executable code.
function executableCodeOnly(source) {
  let result = "";
  let state = "code";
  let escaped = false;
  const templateExpressionDepths = [];

  const mask = (character) => (character === "\n" || character === "\r" ? character : " ");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n" || character === "\r") {
        result += character;
        state = "code";
      } else {
        result += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += mask(character);
      }
      continue;
    }

    if (state === "single-quote" || state === "double-quote") {
      result += mask(character);
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"')
      ) {
        state = "code";
      }
      continue;
    }

    if (state === "template") {
      result += mask(character);
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "$" && next === "{") {
        result += " ";
        index += 1;
        templateExpressionDepths.push(1);
        state = "code";
      } else if (character === "`") {
        state = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else if (character === "'") {
      result += " ";
      state = "single-quote";
    } else if (character === '"') {
      result += " ";
      state = "double-quote";
    } else if (character === "`") {
      result += " ";
      state = "template";
    } else if (templateExpressionDepths.length > 0 && character === "{") {
      templateExpressionDepths[templateExpressionDepths.length - 1] += 1;
      result += character;
    } else if (templateExpressionDepths.length > 0 && character === "}") {
      const lastIndex = templateExpressionDepths.length - 1;
      templateExpressionDepths[lastIndex] -= 1;
      result += character;
      if (templateExpressionDepths[lastIndex] === 0) {
        templateExpressionDepths.pop();
        state = "template";
      }
    } else {
      result += character;
    }
  }

  return result;
}

function moduleSpecifiers(source) {
  const withoutComments = stripComments(source);
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

async function verifyPackageLayout() {
  const rule = "Invariant 1: declared workspace package layout";
  const packagesDirectory = path.join(repoRoot, "packages");
  const info = await pathInfo(packagesDirectory);
  if (!info?.isDirectory()) {
    report(rule, "Required packages/ directory is missing.");
    return;
  }

  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const actualDirectories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const unexpectedDirectories = actualDirectories.filter((name) => !WORKSPACE_PACKAGES.includes(name));
  const missingDirectories = WORKSPACE_PACKAGES.filter((name) => !actualDirectories.includes(name));
  const unexpectedFiles = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name).sort();

  if (unexpectedDirectories.length > 0) {
    report(rule, `Unexpected package directories: ${unexpectedDirectories.join(", ")}.`);
  }
  if (missingDirectories.length > 0) {
    report(rule, `Missing core package directories: ${missingDirectories.join(", ")}.`);
  }
  if (unexpectedFiles.length > 0) {
    report(rule, `Unexpected entries at the package root: ${unexpectedFiles.join(", ")}.`);
  }
}

async function verifyProtocolBoundaries() {
  const rule = "Invariant 2: protocol zero-dependency";
  const protocolDirectory = path.join(repoRoot, "packages", "protocol");
  const packageJsonPath = path.join(protocolDirectory, "package.json");
  const packageJson = await readJson(packageJsonPath, rule);

  if (packageJson) {
    const dependencies = packageJson.dependencies;
    if (dependencies !== undefined && (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))) {
      report(rule, `${relativePath(packageJsonPath)} dependencies must be an object.`);
    } else {
      const forbidden = Object.keys(dependencies ?? {}).filter((name) => name !== "zod");
      if (forbidden.length > 0) {
        report(rule, `${relativePath(packageJsonPath)} dependencies may contain only zod; found: ${forbidden.join(", ")}.`);
      }
    }
  }

  const sourceDirectory = path.join(protocolDirectory, "src");
  if (!(await pathInfo(sourceDirectory))?.isDirectory()) {
    report(rule, `Required source directory ${relativePath(sourceDirectory)} is missing.`);
    return;
  }

  const forbiddenNodeModules = ["node:fs", "node:sqlite", "node:http"];
  const sourceFiles = await walkFiles(sourceDirectory, {
    include: (filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath)),
  });

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (
        forbiddenNodeModules.some((name) => matchesPackage(specifier, name)) ||
        specifier === "@ai0" ||
        specifier.startsWith("@ai0/")
      ) {
        report(rule, `${relativePath(filePath)} imports forbidden module "${specifier}".`);
      }
    }
  }
}

async function verifyPluginBoundaries() {
  const rule = "Invariant 3: plugins universal zero-backdoor";
  const pluginsDirectory = path.join(repoRoot, "plugins");
  if (!(await pathInfo(pluginsDirectory))?.isDirectory()) {
    report(rule, "Required plugins/ directory is missing.");
    return;
  }

  const packageJsonFiles = await walkFiles(pluginsDirectory, {
    include: (filePath) => path.basename(filePath) === "package.json",
  });

  for (const packageJsonPath of packageJsonFiles) {
    const packageJson = await readJson(packageJsonPath, rule);
    if (!packageJson) continue;

    for (const dependency of dependencyEntries(packageJson)) {
      if (dependency.invalid) {
        report(rule, `${relativePath(packageJsonPath)} ${dependency.section} must be an object.`);
      } else if (
        dependency.name.startsWith("@ai0/") &&
        !PLUGIN_ALLOWED_INTERNAL_DEPENDENCIES.has(dependency.name)
      ) {
        report(
          rule,
          `${relativePath(packageJsonPath)} ${dependency.section} contains forbidden internal dependency "${dependency.name}"; among @ai0/* packages, plugins may depend only on @ai0/protocol and @ai0/sdk.`,
        );
      }
    }
  }

  const sourceFiles = await walkFiles(pluginsDirectory, {
    include: (filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath)),
  });
  const forbiddenHostDirectories = [
    ...WORKSPACE_PACKAGES.filter(name => !PLUGIN_ALLOWED_INTERNAL_DEPENDENCIES.has("@ai0/" + name))
      .map(name => ({ packageName: "@ai0/" + name, directory: path.resolve(repoRoot, "packages", name) })),
    { packageName: "@ai0/console-webui", directory: path.resolve(repoRoot, "apps", "console") },
    { packageName: "@ai0/daemon", directory: path.resolve(repoRoot, "apps", "daemon") },
  ];

  for (const filePath of sourceFiles) {
    const source = await readFile(filePath, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (specifier.startsWith("@ai0/") &&
          ![...PLUGIN_ALLOWED_INTERNAL_DEPENDENCIES].some(name => matchesPackage(specifier, name))) {
        report(rule, `${relativePath(filePath)} imports forbidden package "${specifier}".`);
        continue;
      }

      if (!specifier.startsWith(".") && !specifier.startsWith("..\\")) continue;
      const normalizedSpecifier = specifier.replace(/[?#].*$/, "").replaceAll("\\", path.sep);
      const resolvedImport = path.resolve(path.dirname(filePath), normalizedSpecifier);
      const escapedTarget = forbiddenHostDirectories.find(({ directory }) => {
        const relative = path.relative(directory, resolvedImport);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      });
      if (escapedTarget) {
        report(
          rule,
          `${relativePath(filePath)} uses a relative backdoor import "${specifier}" into ${escapedTarget.packageName}.`,
        );
      }
    }
  }
}

async function verifyCoreDependencies() {
  const rule = "Invariant 4: core dependency direction and headless purity";
  const packagesRoot = path.join(repoRoot, "packages");
  for (const name of WORKSPACE_PACKAGES) {
    const packageRoot = path.join(packagesRoot, name);
    const packageJsonPath = path.join(packageRoot, "package.json");
    const allowed = INTERNAL_ALLOWLIST[name];
    const headless = HEADLESS_CORES.includes(name);
    const check = (specifier, file) => {
      if (specifier.startsWith("@ai0/") && !allowed.some(dep => matchesPackage(specifier, "@ai0/" + dep))) {
        report(rule, relativePath(file) + ' uses forbidden internal dependency "' + specifier + '".');
      }
      if (headless && isForbiddenHeadlessDependency(specifier)) {
        report(rule, relativePath(file) + ' uses non-headless dependency "' + specifier + '".');
      }
    };
    for (const dependency of dependencyEntries(await readJson(packageJsonPath, rule))) {
      if (dependency.invalid) report(rule, relativePath(packageJsonPath) + " has an invalid " + dependency.section + " section.");
      else check(dependency.name, packageJsonPath);
    }
    const files = await walkFiles(packageRoot, {
      include: file => SOURCE_EXTENSIONS.has(path.extname(file))
    });
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const specifier of moduleSpecifiers(source)) {
        check(specifier, file);
        if (!specifier.startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), specifier.replace(/[?#].*$/, "").replaceAll("\\", path.sep));
        const [other] = path.relative(packagesRoot, target).split(path.sep);
        if (WORKSPACE_PACKAGES.includes(other) && other !== name) check("@ai0/" + other, file);
      }
      if (name === "agent-core" && AGENT_DOMAIN_TERMS.test(stripComments(source))) {
        report(rule, relativePath(file) + " contains a cognition or persona domain term.");
      }
      if ((headless || name === "gateway") && relativePath(file) !== "packages/cognition-core/src/kernel/virtual-clock.ts" &&
          /\bDate\s*\.\s*now\s*\(/.test(executableCodeOnly(source))) {
        report(rule, relativePath(file) + " calls raw Date.now(); inject VirtualClock instead.");
      }
    }
  }
}

async function verifyDesignSystemModularity() {
  const rule = "Invariant 5: console design-system modularity";
  const designSystemDirectory = path.join(repoRoot, "apps", "console", "src", "design-system");
  if (!(await pathInfo(designSystemDirectory))?.isDirectory()) {
    report(rule, `Required directory ${relativePath(designSystemDirectory)} is missing.`);
    return;
  }

  for (const directoryName of DESIGN_SYSTEM_DIRECTORIES) {
    const directory = path.join(designSystemDirectory, directoryName);
    if (!(await pathInfo(directory))?.isDirectory()) {
      report(rule, `Missing required design-system subdirectory ${relativePath(directory)}.`);
    }
  }

  const monolithPath = path.join(designSystemDirectory, "index.tsx");
  if ((await pathInfo(monolithPath))?.isFile()) {
    report(rule, `${relativePath(monolithPath)} is forbidden; components must live in the five design-system subdirectories.`);
  }
}

async function verifyNoStaticSchemas() {
  const rule = "Invariant 6: no split-brain static schemas";
  const schemaFiles = await walkFiles(repoRoot, {
    include: (filePath) => filePath.toLowerCase().endsWith(".schema.json"),
  });

  for (const filePath of schemaFiles) {
    report(rule, `Hand-maintained schema file ${relativePath(filePath)} is forbidden outside generated build output.`);
  }
}

function matchesAnyPrefix(name, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith("/") ? name.startsWith(pattern) : matchesPackage(name, pattern)
  );
}

async function verifyHostZeroPluginPollution() {
  const rule = "Invariant 7: host zero-plugin-pollution & reverse-dependency lock";
  const pluginsRoot = path.resolve(repoRoot, "plugins");
  const hostRoots = [path.join(repoRoot, "packages"), path.join(repoRoot, "apps")];

  for (const forbiddenPath of [
    path.join(repoRoot, "apps", "console", "src", "webchat"),
    path.join(repoRoot, "apps", "daemon", "src", "webchat-runs.ts"),
    path.join(repoRoot, "apps", "daemon", "src", "profiles"),
  ]) {
    if (await pathInfo(forbiddenPath)) {
      report(
        rule,
        `Plugin implementation path ${relativePath(forbiddenPath)} must live inside plugins/**, not inside host apps.`,
      );
    }
  }

  for (const hostRoot of hostRoots) {
    const pkgFiles = await walkFiles(hostRoot, {
      include: (filePath) => path.basename(filePath) === "package.json",
    });

    for (const pkgPath of pkgFiles) {
      const pkg = await readJson(pkgPath, rule);
      if (!pkg) continue;
      const relPkg = relativePath(pkgPath);
      for (const dep of dependencyEntries(pkg)) {
        if (dep.invalid) continue;
        if (dep.name.startsWith("@ai0/plugin-")) {
          report(
            rule,
            `${relPkg} ${dep.section} depends on plugin package "${dep.name}"; host packages/apps must never depend on specific plugins at compile time.`,
          );
        }
        if (relPkg === "apps/console/package.json" && matchesAnyPrefix(dep.name, HOST_CONSOLE_FORBIDDEN_PLUGIN_DEPS)) {
          report(
            rule,
            `${relPkg} ${dep.section} contains plugin-specific UI dependency "${dep.name}"; move it into the plugin package's own dependency closure.`,
          );
        }
        if (relPkg === "apps/daemon/package.json" && matchesAnyPrefix(dep.name, HOST_DAEMON_FORBIDDEN_PLUGIN_DEPS)) {
          report(
            rule,
            `${relPkg} ${dep.section} contains plugin-specific dependency "${dep.name}"; keep the daemon protocol layer self-contained.`,
          );
        }
      }
    }

    const srcFiles = await walkFiles(hostRoot, {
      include: (filePath) =>
        SOURCE_EXTENSIONS.has(path.extname(filePath)) &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(filePath),
    });

    for (const filePath of srcFiles) {
      const source = await readFile(filePath, "utf8");
      const relFile = relativePath(filePath);
      for (const specifier of moduleSpecifiers(source)) {
        if (specifier.startsWith("@ai0/plugin-")) {
          report(
            rule,
            `${relFile} imports plugin package "${specifier}"; host code must mount plugins dynamically via manifests and SDK contracts.`,
          );
          continue;
        }
        if (specifier.startsWith(".") || specifier.startsWith("..\\")) {
          const normalized = specifier.replace(/[?#].*$/, "").replaceAll("\\", path.sep);
          const resolved = path.resolve(path.dirname(filePath), normalized);
          const relToPlugins = path.relative(pluginsRoot, resolved);
          if (relToPlugins === "" || (!relToPlugins.startsWith("..") && !path.isAbsolute(relToPlugins))) {
            report(rule, `${relFile} imports plugin source "${specifier}" directly across the host boundary.`);
          }
        }
      }

      if ([...HEADLESS_CORES, "storage"].some(name => relFile.startsWith("packages/" + name + "/src/"))) {
        const code = executableCodeOnly(source);
        if (/\b(?:listWebChat|markWebChat|handleWebChat)[A-Za-z0-9_]*\b/.test(code)) {
          report(
            rule,
            `${relFile} defines or calls a WebChat-specific method; core package APIs must be parameterized by generic channel_id.`,
          );
        }
      }
    }
  }
}

let verification;

// Read descriptor declarations without loading plugin or application code. Shared contracts
// are identified by their public symbol, inline descriptors by the same ID/version as the host.
function facetDeclarations(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const facets = [];
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const variable of statement.declarationList.declarations) {
      const call = variable.initializer;
      if (!call || !ts.isCallExpression(call) || call.expression.getText(tree) !== "defineFacetPoint") continue;
      const spec = call.arguments[0];
      if (!spec) continue;
      let contract = spec.getText(tree);
      if (ts.isObjectLiteralExpression(spec)) {
        const fields = Object.fromEntries(spec.properties.filter(ts.isPropertyAssignment)
          .map(property => [property.name.getText(tree), property.initializer.getText(tree)]));
        contract = JSON.stringify([fields.owner, fields.name, fields.version]);
      }
      facets.push([variable.name.getText(tree), contract]);
    }
  }
  return facets;
}

const STATEFUL_STRATIFIED_PACKAGES = [
  "extension-core",
  "agent-core",
  "agent-runtime",
  "perception-core",
  "cognition-core",
  "expression-core",
  "storage",
  "gateway",
];

async function verifyDomainAndAuthorBoundaries() {
  const rule = "Invariant 8: domain ownership, clean-slate v1 purity, and bidirectional public author contracts";
  const domainTerms = /COMPANION_HOMEOSTASIS_DESCRIPTORS|theatrical_subtext|W1FastDialogueWorker|LorebookMatcher|digitalLifeDialogueProfile|drive_social_longing|romantic_partner|vtuber_partner|gapMoeIntensity|钻进被窝|builtin\.lorebook-contributor/;
  const legacyShimTerms = /legacySeedDigests|D2_HOMEOSTASIS_AFFECT|legacyToolContract|legacy_unknown|migrateLegacyAffect|agentToolDefinitionFacet/;
  const ownerFacets = new Map();
  const sdkFacets = new Map();
  const sdkExportsHost = /export\s+\*\s+from\s+["']@ai0\/extension-core["']/.test(
    await readFile(path.join(repoRoot, "packages/sdk/src/index.ts"), "utf8"));
  const productionTs = file => file.endsWith(".ts") && !file.endsWith(".test.ts");
  for (const name of WORKSPACE_PACKAGES) {
    const directory = path.join(repoRoot, "packages", name, "src");
    for (const file of await walkFiles(directory, { include: productionTs })) {
      const source = await readFile(file, "utf8");
      const stripped = stripComments(source);
      if (legacyShimTerms.test(stripped)) {
        report(rule, relativePath(file) + " retains a forbidden Clean-Slate V1 legacy shim or deprecated facet.");
      }
      if (name !== "sdk" && name !== "protocol" && domainTerms.test(stripped)) {
        report(rule, relativePath(file) + " embeds a digital-life strategy or companion preset in a neutral package.");
      }
      for (const specifier of moduleSpecifiers(source)) {
        if (!specifier.startsWith(".")) continue;
        const target = relativePath(path.resolve(path.dirname(file), specifier));
        if (target.startsWith("apps/") || target.startsWith("plugins/")) {
          report(rule, relativePath(file) + " imports application or plugin code via " + specifier);
        }
      }
      if (HEADLESS_CORES.includes(name) || name === "sdk") {
        for (const [point, identity] of facetDeclarations(file, source)) {
          (name === "sdk" ? sdkFacets : ownerFacets).set(point, identity);
          if (name === "extension-core" && sdkExportsHost) sdkFacets.set(point, identity);
        }
      }
    }
  }
  for (const [name, identity] of ownerFacets) {
    if (sdkFacets.get(name) !== identity) report(rule, name + " must have the same SDK and core contract.");
  }
  const hostUiSdkFacets = new Set([
    "channelBridgeFacet",
    "consoleSurfaceFacet",
    "consoleUiSlotFacet",
    "consoleConfigSchemaFacet",
  ]);
  for (const [name, identity] of sdkFacets) {
    if (hostUiSdkFacets.has(name)) continue;
    if (ownerFacets.get(name) !== identity) {
      report(rule, name + " is exported by @ai0/sdk without a matching 1:1 owner core FacetPoint.");
    }
  }
  for (const file of await walkFiles(path.join(repoRoot, "apps", "daemon", "src"), { include: productionTs })) {
    const stripped = stripComments(await readFile(file, "utf8"));
    if (/["']builtin\.lorebook-contributor["']/.test(stripped)) {
      report(rule, relativePath(file) + " selects a context contributor by package ID.");
    }
    if (legacyShimTerms.test(stripped)) {
      report(rule, relativePath(file) + " retains a forbidden Clean-Slate V1 legacy shim.");
    }
  }
}

async function verifyTwoTierMicrokernelStratification() {
  const rule = "Invariant 9: seven-package two-tier microkernel stratification (kernel <- subsystems)";
  for (const name of STATEFUL_STRATIFIED_PACKAGES) {
    const pkgRoot = path.join(repoRoot, "packages", name);
    const pkgJsonPath = path.join(pkgRoot, "package.json");
    const pkgJson = await readJson(pkgJsonPath, rule);
    const exportsMap = pkgJson?.exports;
    if (!exportsMap || typeof exportsMap !== "object" || !exportsMap["."] || !exportsMap["./kernel"] || !exportsMap["./subsystems"]) {
      report(rule, `${relativePath(pkgJsonPath)} must expose ".", "./kernel", and "./subsystems" subpath exports.`);
    }
    const kernelDir = path.join(pkgRoot, "src", "kernel");
    const subsystemsDir = path.join(pkgRoot, "src", "subsystems");
    if (!(await pathInfo(path.join(kernelDir, "index.ts")))?.isFile()) {
      report(rule, `packages/${name}/src/kernel/index.ts is missing.`);
    }
    if (!(await pathInfo(path.join(subsystemsDir, "index.ts")))?.isFile()) {
      report(rule, `packages/${name}/src/subsystems/index.ts is missing.`);
    }
    const kernelFiles = await walkFiles(kernelDir, {
      include: (filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath)),
    });
    for (const filePath of kernelFiles) {
      const source = await readFile(filePath, "utf8");
      for (const specifier of moduleSpecifiers(source)) {
        if (specifier === `@ai0/${name}/subsystems` || specifier.startsWith(`@ai0/${name}/subsystems/`)) {
          report(rule, `${relativePath(filePath)} imports L1 subsystems package "${specifier}" from L0 kernel.`);
          continue;
        }
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(filePath), specifier.replace(/[?#].*$/, "").replaceAll("\\", path.sep));
        const relToSubsystems = path.relative(subsystemsDir, resolved);
        if (relToSubsystems === "" || (!relToSubsystems.startsWith("..") && !path.isAbsolute(relToSubsystems))) {
          report(rule, `${relativePath(filePath)} imports L1 subsystems module "${specifier}" from L0 kernel.`);
        }
      }
    }
  }
}

export function verifyArchitectureBoundaries() {
  verification ??= (async () => {
    await verifyPackageLayout();
    await verifyProtocolBoundaries();
    await verifyPluginBoundaries();
    await verifyCoreDependencies();
    await verifyDesignSystemModularity();
    await verifyNoStaticSchemas();
    await verifyHostZeroPluginPollution();
    await verifyDomainAndAuthorBoundaries();
    await verifyTwoTierMicrokernelStratification();
    return Object.freeze([...violations]);
  })();
  return verification;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await verifyArchitectureBoundaries();
  if (result.length > 0) {
    console.error(`Architecture boundary verification failed with ${result.length} violation(s):`);
    for (const violation of result) console.error(`  - ${violation}`);
    process.exitCode = 1;
  } else {
    console.log("Architecture boundary verification passed: all 9 invariants hold.");
  }
}
