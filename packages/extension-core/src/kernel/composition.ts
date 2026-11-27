import { Context } from "@deepseek-ai/cordis";

/** A service name is local to one host and one version of an extension contract. */
export interface ExtensionPoint<T> {
  readonly owner: string;
  readonly name: string;
  readonly version: number;
  readonly parse: (value: unknown) => T;
}

export interface ExtensionScope {
  define<T>(point: ExtensionPoint<T>, accept: (value: T) => () => void): () => void;
  contribute<T>(point: ExtensionPoint<T>, value: T, active?: (scope: ExtensionScope) => void): void;
  effect(acquire: () => () => void | Promise<void>): void;
}

function serviceName(point: ExtensionPoint<unknown>): string {
  if (!point.owner || !point.name || !Number.isSafeInteger(point.version) || point.version < 1) {
    throw new TypeError("Invalid extension point");
  }
  return "ai0.point." + JSON.stringify([point.owner, point.name, point.version]);
}

function scoped(ctx: Context, owner: string): ExtensionScope {
  return {
    define(point, accept) {
      if (point.owner !== owner) throw new Error("Extension point belongs to another plugin");
      return ctx.provide(serviceName(point), (input: unknown) => accept(point.parse(input)));
    },
    contribute(point, value, active) {
      const key = serviceName(point);
      ctx.inject([key], child => {
        child.effect(() => child.get(key)(value));
        active?.(scoped(child, owner));
      });
    },
    effect(acquire) { ctx.effect(acquire); }
  };
}

export class ExtensionComposition {
  private readonly root = new Context();
  mount(owner: string, activate: (scope: ExtensionScope) => void) {
    const fiber = this.root.plugin(ctx => activate(scoped(ctx, owner)));
    return {
      ready: async () => {
        try { await fiber.await(); }
        catch (error) { await fiber.dispose(); throw error; }
      },
      dispose: async () => { if (fiber.uid !== null) await fiber.dispose(); }
    };
  }
  dispose() { return this.root.fiber.dispose(); }
}
