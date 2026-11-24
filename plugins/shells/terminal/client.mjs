import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

const base = new URL("/protocol/v0/shell/", process.env.AI0_URL ?? "http://127.0.0.1:4173");
const token = process.env.AI0_SHELL_TOKEN;
if (!token) throw new Error("Set AI0_SHELL_TOKEN to the scoped shell grant.");
const shellId = process.env.AI0_SHELL_ID ?? "builtin.terminal.default";
const mode = process.env.AI0_MODE ?? "live";
const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
async function request(path, body, method = "POST") {
  const response = await fetch(new URL(path, base), { method, headers, body: body && JSON.stringify(body) });
  if (!response.ok) throw new Error("Shell protocol " + response.status + ": " + await response.text());
  return response;
}

const manifest = { protocol_version: "0.1.0", shell_id: shellId, shell_kind: "cli",
  display_name: "Terminal", venue_type: "private_1on1", current_audience: { scope: "only_owner", member_count: 1 },
  latency_budget_ms: 1200, capabilities: { sensors: ["text"], supported_extensions: [], actuators: [] } };
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const input = lines[Symbol.asyncIterator]();
const { session_id: sessionId } = await (await request("connections", manifest)).json();
const lease = "connections/" + sessionId;
const renew = setInterval(() => void request(lease, {}, "PATCH").catch(err => {
  console.error(err.message);
  lines.close();
}), 15000);
try {
  for await (const text of { [Symbol.asyncIterator]: () => input }) {
    if (!text.trim()) continue;
    const requestId = randomUUID();
    const response = await request("runs", { requestId, mode, shellId, text });
    let offset = 0;
    let sources = [];
    let pending = "";
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      pending += chunk;
      let end;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
        if (!data || data === "[DONE]") continue;
        const item = JSON.parse(data);
        if (item.type === "error") throw new Error(item.errorText);
        if (item.type === "data-turn" && item.data.sources) sources = item.data.sources;
        if (item.type === "text-delta") {
          await new Promise((resolve, reject) => process.stdout.write(item.delta, err => err ? reject(err) : resolve()));
          offset += Array.from(item.delta).length;
        }
      }
    }
    await request("runs/" + requestId + "/receipt", { mode, spokenCharOffset: offset });
    for(const s of sources) process.stdout.write("\n[K"+s.marker+"] "+s.title+" · "+s.location);
    process.stdout.write("\n");
  }
} finally {
  clearInterval(renew);
  lines.close();
  await request(lease, undefined, "DELETE");
}
