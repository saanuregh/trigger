import type { z } from "zod";
import { logger } from "../logger.ts";
import type { ActionContext } from "./types.ts";

export interface RegisteredAction {
  name: string;
  schema: z.ZodType;
  handler: (config: unknown, ctx: ActionContext) => Promise<{ output?: Record<string, unknown> }>;
  builtin: boolean;
}

const registry = new Map<string, RegisteredAction>();

export function registerAction(action: RegisteredAction): void {
  if (registry.has(action.name)) {
    throw new Error(`Action "${action.name}" is already registered`);
  }
  registry.set(action.name, action);
  logger.info({ action: action.name, builtin: action.builtin }, "action registered");
}

export function getAction(name: string): RegisteredAction | undefined {
  return registry.get(name);
}

export function getActionNames(): string[] {
  return [...registry.keys()];
}

export function clearRegistry(): void {
  registry.clear();
}

export function getAllActionSchemas(): Array<{ name: string; schema: z.ZodType }> {
  return [...registry.values()].map((a) => ({ name: a.name, schema: a.schema }));
}
