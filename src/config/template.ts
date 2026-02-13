import type { ParamValues } from "../types.ts";

export interface ResolveContext {
  params: ParamValues;
  vars: Record<string, unknown>;
}

export const TEMPLATE_RE = /\{\{(.+?)\}\}/g;
const FULL_TEMPLATE_RE = /^\{\{(.+?)\}\}$/;

export interface TemplateRef {
  type: "vars" | "param";
  name: string;
  fallback?: string;
}

export function parseTemplateRef(expr: string): TemplateRef | null {
  const trimmed = expr.trim();
  if (trimmed.startsWith("vars.")) {
    return { type: "vars", name: trimmed.slice(5) };
  }
  if (trimmed.startsWith("param.")) {
    const rest = trimmed.slice(6);
    const pipeIdx = rest.indexOf("|");
    if (pipeIdx !== -1) {
      return { type: "param", name: rest.slice(0, pipeIdx).trim(), fallback: rest.slice(pipeIdx + 1).trim() };
    }
    return { type: "param", name: rest };
  }
  return null;
}

function resolveExpression(expr: string, ctx: ResolveContext): unknown {
  const ref = parseTemplateRef(expr);
  if (!ref) {
    throw new Error(`Invalid template expression: {{${expr.trim()}}} — must start with "vars." or "param."`);
  }

  if (ref.type === "vars") {
    if (!(ref.name in ctx.vars)) throw new Error(`Undefined variable: vars.${ref.name}`);
    return ctx.vars[ref.name];
  }

  if (ref.fallback !== undefined) {
    const val = ctx.params[ref.name];
    return val === undefined || val === "" ? ref.fallback : val;
  }

  const val = ctx.params[ref.name];
  if (val === undefined) throw new Error(`Missing required parameter: ${ref.name}`);
  return val;
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
