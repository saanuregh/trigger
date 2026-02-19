import type { JSONValue } from "../types.ts";

export { z } from "zod";
export { booleanOrTemplate, numberOrTemplate, stringArrayOrTemplate, stringOrTemplate, templateString } from "../config/schema.ts";

export interface ActionContext {
  runId: string;
  stepId: string;
  region: string;
  signal: AbortSignal;
  log: (msg: string, fields?: Record<string, JSONValue | undefined>) => void;
  warn: (msg: string, fields?: Record<string, JSONValue | undefined>) => void;
  callStack?: string[];
  triggeredBy?: string;
  executePipeline?: (
    ns: string,
    pipelineId: string,
    params: Record<string, string | boolean>,
    options: { signal: AbortSignal; parentCallStack?: string[]; triggeredBy?: string },
  ) => Promise<string>;
}

export interface CustomActionDefinition<T = JSONValue> {
  name: string;
  schema: import("zod").ZodType<T>;
  handler: (config: T, ctx: ActionContext) => Promise<{ output?: Record<string, JSONValue> }>;
}

export function defineAction<T>(def: CustomActionDefinition<T>): CustomActionDefinition<T> {
  return def;
}

const UNRESOLVED_RE = /\{\{.+?\}\}/;

export function expectString(value: JSONValue, field: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${field} to be a string, got ${typeof value}`);
  if (value === "") throw new Error(`${field} cannot be an empty string`);
  if (UNRESOLVED_RE.test(value)) throw new Error(`Unresolved template in ${field}: ${value}`);
  return value;
}

export function expectStringArray(value: JSONValue, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${field} to be an array, got ${typeof value}`);
  return value.map((item, i) => expectString(item, `${field}[${i}]`));
}

export function expectNumber(value: JSONValue, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected ${field} to be a finite number, got ${value}`);
  return value;
}

export function expectBoolean(value: JSONValue, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Expected ${field} to be a boolean, got ${typeof value}: ${String(value)}`);
  return value;
}

export function expectEnum<T extends string>(value: JSONValue, field: string, allowed: readonly T[]): T {
  const s = expectString(value, field);
  if (!allowed.includes(s as T)) throw new Error(`Invalid ${field}: "${s}" — must be one of: ${allowed.join(", ")}`);
  return s as T;
}
