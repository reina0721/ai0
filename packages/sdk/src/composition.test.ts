import { describe, expect, it } from "vitest";
import { ExtensionComposition, type ExtensionScope } from "./composition.js";

const actions = { owner: "page", name: "actions", version: 1, parse: String };
const menu = { owner: "button", name: "menu", version: 1, parse: String };
const orders = ["abc", "acb", "bac", "bca", "cab", "cba"];

describe("reversible nested extension contracts", () => {
  it.each(orders)("mounts independent packages in order %s", async order => {
    const runtime = new ExtensionComposition();
    const visible = new Set<string>();
    const accept = (item: string) => {
      expect(visible.has(item)).toBe(false);
      visible.add(item);
      return () => { visible.delete(item); };
    };
    const plugins: Record<string, [string, (scope: ExtensionScope) => void]> = {
      a: ["page", scope => { scope.define(actions, accept); }],
      b: ["button", scope => { scope.contribute(actions, "button", child => { child.define(menu, accept); }); }],
      c: ["item", scope => { scope.contribute(menu, "item"); scope.effect(() => accept("independent")); }]
    };
    const bindings = new Map<string, ReturnType<ExtensionComposition["mount"]>>();
    for (const id of order) bindings.set(id, runtime.mount(...plugins[id]!));
    await expect.poll(() => [...visible].sort()).toEqual(["button", "independent", "item"]);
    await bindings.get("c")!.dispose();
    await expect.poll(() => [...visible]).toEqual(["button"]);
    bindings.set("c", runtime.mount(...plugins.c!));
    await expect.poll(() => visible.size).toBe(3);
    await bindings.get("b")!.dispose();
    await expect.poll(() => [...visible]).toEqual(["independent"]);
    bindings.set("b", runtime.mount(...plugins.b!));
    await expect.poll(() => visible.size).toBe(3);
    await bindings.get("a")!.dispose();
    await expect.poll(() => [...visible]).toEqual(["independent"]);
    await runtime.dispose();
    expect(visible.size).toBe(0);
  });
  it("releases timers, listeners and rejects late registrations after reload", async () => {
    const emitter = new EventTarget();
    const host = new ExtensionComposition();
    let ticks = 0;
    let commands = 0;
    let late!: ExtensionScope;
    for (let reload = 0; reload < 3; reload++) {
      const fiber = host.mount("clock", scope => {
        late = scope;
        scope.effect(() => {
          const call = () => { commands++; };
          const timer = setInterval(() => { ticks++; }, 2);
          emitter.addEventListener("command", call);
          return () => { clearInterval(timer); emitter.removeEventListener("command", call); };
        });
      });
      await fiber.ready();
      emitter.dispatchEvent(new Event("command"));
      await fiber.dispose();
      const atRemoval = ticks;
      emitter.dispatchEvent(new Event("command"));
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(ticks).toBe(atRemoval);
      expect(commands).toBe(reload + 1);
      expect(() => late.effect(() => () => {})).toThrow();
    }
    await host.dispose();
  });
  it("cleans acquisitions when activation fails", async () => {
    const runtime = new ExtensionComposition();
    let active = 0;
    const binding = runtime.mount("broken", scope => {
      scope.effect(() => { active++; return () => { active--; }; });
      throw Error("fixture failure");
    });
    await expect(binding.ready()).rejects.toThrow("fixture failure");
    await binding.dispose();
    expect(active).toBe(0);
    await runtime.dispose();
  });
});
