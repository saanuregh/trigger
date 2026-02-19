import { z } from "zod";
import { errorMessage } from "../types.ts";
import type { RouteRequest } from "./controllers/helpers.ts";

// --- Schemas ---

export const triggerRunRequestSchema = z.object({
  params: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  dryRun: z.boolean().optional(),
});

const coerceInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
    });

export const listRunsQuerySchema = z.object({
  ns: z.string().optional(),
  pipeline_id: z.string().optional(),
  status: z.enum(["pending", "running", "success", "failed", "cancelled"]).optional(),
  page: coerceInt(1),
  per_page: coerceInt(20).transform((v) => Math.min(v, 100)),
});

export const wsClientMessageSchema = z.union([
  z.object({ type: z.literal("subscribe"), topic: z.string() }),
  z.object({ type: z.literal("unsubscribe"), topic: z.string() }),
]);

// --- Validation helpers ---

type ValidationResult<T> = { success: true; data: T } | { success: false; error: string };

export async function validateBody<T>(req: RouteRequest, schema: z.ZodType<T>): Promise<ValidationResult<T>> {
  try {
    const body = (await req.json()) as unknown;
    const result = schema.safeParse(body);
    if (!result.success) return { success: false, error: formatZodError("Request validation failed", result.error) };
    return { success: true, data: result.data };
  } catch (err) {
    return { success: false, error: `Failed to parse request body: ${errorMessage(err)}` };
  }
}

export function validateQuery<T>(url: URL, schema: z.ZodType<T>): ValidationResult<T> {
  const result = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!result.success) return { success: false, error: formatZodError("Query validation failed", result.error) };
  return { success: true, data: result.data };
}

function formatZodError(prefix: string, error: z.ZodError): string {
  const details = error.issues.map((i) => `${i.path.join(".") || "/"}: ${i.message}`).join("; ");
  return `${prefix}: ${details}`;
}
