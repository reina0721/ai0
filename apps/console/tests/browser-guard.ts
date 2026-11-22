import type { Page } from "@playwright/test";

export function watchBrowser(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || (message.type() === "warning" && /out-of-range value|uncontrolled to controlled|controlled to uncontrolled/iu.test(message.text()))) {
      errors.push(message.text());
    }
  });
  page.on("dialog", async (dialog) => {
    errors.push(`Native ${dialog.type()} dialog: ${dialog.message()}`);
    await dialog.dismiss().catch(() => undefined);
  });
  return { takeErrors: () => errors.splice(0) };
}

export async function workspaceGeometry(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-console-root]")!;
    const bar = root.querySelector(".ai0-hybrid-top-bar")!;
    const main = root.querySelector("main")!;
    const body = main.querySelector(".ai0-main-scrollable-body")!;
    return {
      document: document.documentElement.scrollWidth - innerWidth,
      topBar: bar.scrollWidth - bar.clientWidth,
      main: main.scrollWidth - main.clientWidth,
      routeBody: body.scrollWidth - body.clientWidth
    };
  });
}
