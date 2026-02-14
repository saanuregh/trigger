import { z } from "zod";
import { logger } from "../logger.ts";
import { parseTemplateRef, TEMPLATE_RE, type TemplateRef } from "./template.ts";

export const templateString = z.string().regex(/\{\{.+?\}\}/);
export const stringOrTemplate = z.string();
export const stringArrayOrTemplate = z.union([z.array(z.string()), templateString]);
export const numberOrTemplate = z.union([z.number(), templateString]);
export const booleanOrTemplate = z.union([z.boolean(), templateString]);

const stringParam = z
  .object({
    name: z.string(),
    label: z.string(),
    type: z.literal("string"),
    required: z.boolean().optional(),
    default: z.string().optional(),
    placeholder: z.string().optional(),
  })
  .strict();

const booleanParam = z
  .object({
    name: z.string(),
    label: z.string(),
    type: z.literal("boolean"),
    default: z.boolean().optional(),
  })
  .strict();

const selectParam = z
  .object({
    name: z.string(),
    label: z.string(),
    type: z.literal("select"),
    options: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
    required: z.boolean().optional(),
    default: z.string().optional(),
  })
  .strict();

const paramDef = z.discriminatedUnion("type", [stringParam, booleanParam, selectParam]);

const switchConfig = z
  .object({
    $switch: z.string(),
    cases: z.record(z.string(), z.unknown()).optional(),
    default: z.unknown().optional(),
  })
  .strict();

const accessConfig = z
  .object({
    groups: z.array(z.string()),
  })
  .strict()
  .optional();

export function buildSchema(actions: Array<{ name: string; schema: z.ZodType }>) {
  const actionMap = new Map(actions.map((a) => [a.name, a.schema]));

  const stepDef = z
    .object({
      id: z.string(),
      name: z.string(),
      action: z.string(),
      config: z.unknown(),
    })
    .strict()
    .superRefine((step, ctx) => {
      const schema = actionMap.get(step.action);
      if (!schema) return; // unknown action — accept any config

      const switchResult = switchConfig.safeParse(step.config);
      if (switchResult.success) return; // $switch config is always valid

      if (hasTemplateRefs(step.config)) return; // templates resolve at runtime

      const result = schema.safeParse(step.config);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({ ...issue, path: ["config", ...issue.path] });
        }
      }
    });

  const pipelineDef = z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      confirm: z.boolean().optional(),
      timeout: z.number().optional(),
      params: z.array(paramDef).optional(),
      access: accessConfig,
      steps: z.array(stepDef),
    })
    .strict();

  return z
    .object({
      $schema: z.string().optional(),
      namespace: z.string(),
      display_name: z.string(),
      aws_region: z.string(),
      vars: z.record(z.string(), z.unknown()).optional(),
      access: accessConfig,
      pipelines: z.array(pipelineDef),
    })
    .strict()
    .superRefine((config, ctx) => {
      const varNames = new Set(Object.keys(config.vars ?? {}));

      for (let pi = 0; pi < config.pipelines.length; pi++) {
        const pipeline = config.pipelines[pi]!;
        const paramNames = new Set((pipeline.params ?? []).map((p) => p.name));

        for (let si = 0; si < pipeline.steps.length; si++) {
          const step = pipeline.steps[si]!;
          const knownNames = { vars: varNames, param: paramNames };
          for (const ref of extractTemplateRefs(step.config)) {
            if (!knownNames[ref.type].has(ref.name)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["pipelines", pi, "steps", si, "config"],
                message: `Unknown ${ref.type === "vars" ? "variable" : "parameter"} reference: {{${ref.type}.${ref.name}}}`,
              });
            }
          }
        }
      }
    });
}

const HAS_TEMPLATE = /\{\{.+?\}\}/;

function hasTemplateRefs(value: unknown): boolean {
  if (typeof value === "string") return HAS_TEMPLATE.test(value);
  if (Array.isArray(value)) return value.some(hasTemplateRefs);
  if (value && typeof value === "object") return Object.values(value).some(hasTemplateRefs);
  return false;
}

function extractTemplateRefs(value: unknown): TemplateRef[] {
  const refs: TemplateRef[] = [];

  function walk(v: unknown) {
    if (typeof v === "string") {
      for (const match of v.matchAll(TEMPLATE_RE)) {
        const ref = parseTemplateRef(match[1]!);
        if (ref) refs.push(ref);
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  }

  walk(value);
  return refs;
}

export type PipelineConfig = ReturnType<typeof buildSchema> extends z.ZodType<infer T> ? T : never;

// ── JSON Schema generation with per-action config typing ──────────

interface JSONSchemaNode {
  type?: string;
  const?: string;
  properties?: Record<string, JSONSchemaNode>;
  items?: JSONSchemaNode;
  required?: string[];
  additionalProperties?: boolean | JSONSchemaNode;
  allOf?: JSONSchemaNode[];
  anyOf?: JSONSchemaNode[];
  if?: JSONSchemaNode;
  then?: JSONSchemaNode;
  not?: JSONSchemaNode;
  [key: string]: unknown;
}

export function buildJSONSchema(zodSchema: z.ZodType, actions: Array<{ name: string; schema: z.ZodType }>): JSONSchemaNode {
  const base = z.toJSONSchema(zodSchema) as JSONSchemaNode;

  if (actions.length === 0) return base;

  const stepItems = base.properties?.pipelines?.items?.properties?.steps?.items;
  if (!stepItems) {
    logger.warn("JSON Schema structure does not match expected layout — per-action config typing unavailable");
    return base;
  }

  const switchSchema = z.toJSONSchema(switchConfig) as JSONSchemaNode;

  stepItems.allOf = actions.map(({ name, schema }) => ({
    if: {
      properties: { action: { const: name } },
      required: ["action"] as string[],
    },
    then: {
      properties: { config: { anyOf: [z.toJSONSchema(schema) as JSONSchemaNode, switchSchema] } },
    },
  }));

  return base;
}
