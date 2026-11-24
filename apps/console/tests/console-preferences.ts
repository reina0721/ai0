import type { DaemonSystemSettings } from "@ai0/protocol";
import { expect, test as base } from "@playwright/test";

export type ConsolePreferences = Pick<
  DaemonSystemSettings, "appearance" | "soulTheme" | "navRailMode" | "inspectorView"
>;

type PreferencesFixture = {
  read: () => Promise<ConsolePreferences>;
  set: (values: Partial<ConsolePreferences>) => Promise<void>;
};

export const test = base.extend<{ consolePreferences: PreferencesFixture }>({
  consolePreferences: async ({ request }, use) => {
    const settingsPath = "/api/admin/v1/system/settings?target_instance=live";
    let headers: { "x-ai0-owner-token": string } | undefined;
    let original: ConsolePreferences | undefined;

    async function read() {
      if (!headers) {
        const bootstrap = await request.get("/api/studio/bootstrap?mode=live");
        expect(bootstrap.ok(), "load the console owner token").toBe(true);
        const { ownerToken } = await bootstrap.json() as { ownerToken: string };
        headers = { "x-ai0-owner-token": ownerToken };
      }
      const response = await request.get(settingsPath, { headers });
      expect(response.ok(), "read shared console preferences").toBe(true);
      const { appearance, soulTheme, navRailMode, inspectorView } = await response.json() as ConsolePreferences;
      return { appearance, soulTheme, navRailMode, inspectorView };
    }

    async function write(data: Partial<ConsolePreferences>) {
      const response = await request.patch(settingsPath, { headers, data });
      expect(response.ok(), `write shared console preferences (${response.status()})`).toBe(true);
    }

    try {
      await use({
        read,
        async set(data) {
          original ??= await read();
          await write(data);
        }
      });
    } finally {
      if (original) await write(original);
    }
  }
});

export { expect };
