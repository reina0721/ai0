import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Three independently discovered packages, built outside the application tree.
export function createCompositionFixtures(scratch) {
  const root = join(scratch, "plugins");
  function install(id, widget, source) {
    const dir = join(root, id);
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "ai0.extension.json"), JSON.stringify({
      extension_id: id, dimension: "ext.console_ui", console_contributions: widget === "page"
        ? { pages: [{ path: "/community/conversation", navigation: true, title: "社区会话", entry_module: "./dist/index.mjs" }] }
        : { modules: ["./dist/index.mjs"] }
    }));
    writeFileSync(join(dir, "dist/index.mjs"), source);
  }
  const contracts = `
    const nodes = (owner, name) => ({ owner, name, version: 1, parse(node) {
      if (!(node instanceof HTMLElement)) throw new TypeError("HTMLElement required");
      return node;
    } });
    const composer = nodes("community.page", "composer");
    const menu = nodes("community.button", "menu");
    const append = parent => child => { parent.appendChild(child); return () => child.remove(); };
  `;
  install("community.page", "page", contracts + `
    export function mountPage(container, host) {
      if (host.shell || "authToken" in host.getState()) throw new Error("Unexpected shell grant on a generic page");
      const form = document.createElement("form");
      form.append(document.createElement("input"));
      container.append(form);
      const dispose = host.contributions.define(composer, append(form));
      return () => { dispose(); form.remove(); };
    }
  `);
  install("community.button", "contribution_module", contracts + `
    export function activate(scope) {
      scope.contribute({ owner: "ai0.console", name: "navigation", version: 1 }, {
        id: "community.page.open", label: "社区会话", path: "/community/conversation"
      });
      const container = document.createElement("div");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "附件操作";
      const list = document.createElement("div");
      list.hidden = true;
      container.append(button, list);
      scope.contribute(composer, container, child => {
        child.define(menu, append(list));
        child.effect(() => {
          const toggle = () => { list.hidden = !list.hidden; };
          button.addEventListener("click", toggle);
          return () => button.removeEventListener("click", toggle);
        });
      });
    }
  `);
  install("community.item", "contribution_module", contracts + `
    export function activate(scope) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = "选择附件";
      scope.contribute(menu, item);
    }
  `);
  install("community.webchat-tools", "contribution_module", `
    export function activate(scope) {
      const point = { owner: "builtin.webchat", name: "composer.actions", version: 1 };
      scope.contribute(point, { label: "扩展工具", run() { document.dispatchEvent(new Event("webchat-tools:open")); } }, child => {
        child.effect(() => {
          const panel = document.createElement("div");
          panel.setAttribute("role", "status");
          const open = () => { panel.textContent = "工具已打开"; document.body.append(panel); };
          document.addEventListener("webchat-tools:open", open);
          return () => { document.removeEventListener("webchat-tools:open", open); panel.remove(); };
        });
      });
    }
  `);
  return root;
}
