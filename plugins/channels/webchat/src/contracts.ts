import type { ExtensionPoint } from "@ai0/sdk";

export type ComposerCommand = { label: string; run(): void };
export const composerActions: ExtensionPoint<ComposerCommand> = {
  owner: "builtin.webchat", name: "composer.actions", version: 1,
  parse(input: unknown): ComposerCommand {
    const command = input as Partial<ComposerCommand> | null;
    if (!command || typeof command.label !== "string" || typeof command.run !== "function")
      throw new TypeError("A composer action needs a label and a run callback");
    return command as ComposerCommand;
  }
};
