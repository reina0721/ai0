import Ajv2020Module from "ajv/dist/2020.js";
import type { AgentValueSchema, Ai0ExtensionManifest } from "@ai0/protocol";
import {
  defaultCarrierProjectors,
  mountCarrierProjections as mountSdkCarrierProjections,
  passiveConsoleSlot,
  resolveEffectiveSkillProjections,
  type CarrierOrigin,
  type CarrierProjectors,
  type ConfiguredCarriers,
  type ExtensionActivationScope,
  type McpCarrierTransport,
  type MountCarrierProjectionsOptions
} from "@ai0/sdk";
import { mcpCapabilities } from "./mcp-capabilities.js";

export {
  defaultCarrierProjectors,
  passiveConsoleSlot,
  resolveEffectiveSkillProjections,
  type CarrierOrigin,
  type CarrierProjectors,
  type ConfiguredCarriers,
  type McpCarrierTransport,
  type MountCarrierProjectionsOptions
};

const Ajv2020 = (
  "default" in Ajv2020Module ? Ajv2020Module.default : Ajv2020Module
) as unknown as new (options: { strict: boolean; validateSchema: boolean }) => {
  compile(schema: Record<string, unknown>): ((value: unknown) => boolean) & { errors?: unknown };
  errorsText(errors?: unknown): string;
};

function ajvCompileSchema(schema: Readonly<Record<string, unknown>>): AgentValueSchema {
  const ajv = new Ajv2020({ strict: true, validateSchema: true });
  const validate = ajv.compile({ ...schema });
  return {
    jsonSchema: schema,
    parse(value: unknown) {
      if (!validate(value)) throw new Error(ajv.errorsText(validate.errors));
      return value;
    }
  };
}

export function mountCarrierProjections(
  scope: ExtensionActivationScope,
  manifest: Ai0ExtensionManifest,
  origin: CarrierOrigin | undefined,
  options: MountCarrierProjectionsOptions = {}
): string[] {
  return mountSdkCarrierProjections(scope, manifest, origin, {
    ...options,
    transport: options.transport ?? mcpCapabilities,
    compileSchema: options.compileSchema ?? ajvCompileSchema
  });
}
