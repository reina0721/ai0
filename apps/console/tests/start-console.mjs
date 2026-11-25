import { createCompositionFixtures } from "./composition-fixtures.mjs";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const workspace = fileURLToPath(new URL("../../../", import.meta.url));
const consoleDir = fileURLToPath(new URL("../", import.meta.url));
const consolePort = process.env.AI0_TEST_CONSOLE_PORT ?? "4183";
const daemonPort = process.env.AI0_TEST_DAEMON_PORT ?? "4184";
const buildDir = process.env.AI0_TEST_BUILD_DIR ? resolve(process.env.AI0_TEST_BUILD_DIR) : undefined;
if (buildDir && !existsSync(join(buildDir, "index.html"))) {
  throw new Error(`Console production build is missing index.html: ${buildDir}`);
}
const scratch = mkdtempSync(join(tmpdir(), "ai0-playwright-"));
const soulDir = process.env.AI0_TEST_SOUL_DIR ? resolve(process.env.AI0_TEST_SOUL_DIR) : join(scratch, "test.soul");
const processes = [
  spawn(process.execPath, ["--conditions=development", "--import", "tsx", "apps/daemon/src/cli.ts",
    "--port", buildDir ? consolePort : daemonPort], {
    cwd: workspace,
    env: {
      ...process.env,
      AI0_PLUGINS_DIR: [createCompositionFixtures(scratch), process.env.AI0_PLUGINS_DIR].filter(Boolean).join(delimiter),
      AI0_USER_PLUGINS_DIR: join(scratch, "user-plugins"),
      AI0_SOUL_DIR: soulDir,
      AI0_SOULS_ROOT: dirname(soulDir),
      AI0_TEST_DETERMINISTIC_MODEL: "1",
      AI0_OWNER_TOKEN: randomUUID(),
      AI0_HOST: "127.0.0.1",
      ...(buildDir ? { AI0_CONSOLE_DIST_DIR: buildDir } : {}),
      AI0_LLM_API_KEY: "",
      OPENAI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      ANTHROPIC_API_KEY: ""
    },
    stdio: "inherit",
    windowsHide: true
  })
];
if (!buildDir) {
  processes.push(spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", consolePort, "--strictPort"], {
    cwd: consoleDir,
    env: { ...process.env, AI0_DAEMON_URL: "http://127.0.0.1:" + daemonPort },
    stdio: "inherit",
    windowsHide: true
  }));
}

let closing = false;
async function close(code) {
  if (closing) return;
  closing = true;
  await Promise.all(processes.map((child) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve();
    return new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill();
    });
  }));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  process.exit(code);
}

for (const child of processes) {
  child.on("error", (error) => { console.error(error); void close(1); });
  child.on("exit", (code) => { void close(code ?? 1); });
}
process.on("SIGINT", () => void close(0));
process.on("SIGTERM", () => void close(0));
