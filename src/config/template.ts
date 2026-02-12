import type { ParamValues } from "../types.ts";

export interface ResolveContext {
  params: ParamValues;
  vars: Record<string, unknown>;
}

const TEMPLATE_RE = /\{\{(.+?)\}\}/g;
const FULL_TEMPLATE_RE = /^\{\{(.+?)\}\}$/;

function resolveExpression(expr: string, ctx: ResolveContext): unknown {
  const trimmed = expr.trim();

  if (trimmed.startsWith("vars.")) {
    const key = trimmed.slice(5);
    if (!(key in ctx.vars)) {
      throw new Error(`Undefined variable: ${trimmed}`);
    }
    return ctx.vars[key];
  }

  if (trimmed.startsWith("param.")) {
    const rest = trimmed.slice(6);
    const pipeIdx = rest.indexOf("|");
    if (pipeIdx !== -1) {
      const name = rest.slice(0, pipeIdx).trim();
      const fallback = rest.slice(pipeIdx + 1).trim();
      const val = ctx.params[name];
      if (val === undefined || val === "") return fallback;
      return val;
    }
    const val = ctx.params[rest];
    if (val === undefined) {
      throw new Error(`Missing required parameter: ${rest}`);
    }
    return val;
  }

  throw new Error(`Invalid template expression: {{${trimmed}}} — must start with "vars." or "param."`);
}

export function resolveConfig(value: unknown, ctx: ResolveContext): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const fullMatch = value.match(FULL_TEMPLATE_RE);
    if (fullMatch) {
      return resolveExpression(fullMatch[1]!, ctx);
    }

    if (value.includes("{{")) {
      return value.replace(TEMPLATE_RE, (_, expr) => String(resolveExpression(expr, ctx)));
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveConfig(item, ctx));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    if ("$switch" in obj) {
      const paramName = obj.$switch as string;
      const paramValue = String(ctx.params[paramName] ?? "");
      const cases = (obj.cases ?? {}) as Record<string, unknown>;

      const selected = cases[paramValue] ?? obj.default;
      if (selected === undefined) {
        throw new Error(`$switch on "${paramName}": no case for "${paramValue}" and no default`);
      }

      return resolveConfig(selected, ctx);
    }

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveConfig(v, ctx);
    }
    return result;
  }

  return value;
}
