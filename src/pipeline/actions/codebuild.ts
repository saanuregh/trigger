import {
  BatchGetBuildsCommand,
  CodeBuildClient,
  type EnvironmentVariable,
  StartBuildCommand,
  StopBuildCommand,
} from "@aws-sdk/client-codebuild";
import { errorMessage } from "../../types.ts";
import { defineAction, expectString, stringOrTemplate, templateString, z } from "../types.ts";
import { lazyClient, pollUntil, streamLogs } from "./aws-utils.ts";

const schema = z
  .object({
    project_name: stringOrTemplate,
    source_version: stringOrTemplate.optional(),
    env_vars: z
      .union([
        z.record(
          z.string(),
          z.union([
            z.string(),
            z.object({ value: z.string(), type: z.enum(["PLAINTEXT", "PARAMETER_STORE", "SECRETS_MANAGER"]) }).strict(),
          ]),
        ),
        templateString,
      ])
      .optional(),
  })
  .strict();

const getCodeBuildClient = lazyClient((region) => new CodeBuildClient({ region }));

export default defineAction({
  name: "codebuild",
  schema,
  handler: async (config, ctx) => {
    const project_name = expectString(config.project_name, "project_name");
    ctx.log("starting codebuild project", { project: project_name });

    const rawEnvVars = (config.env_vars ?? {}) as Record<
      string,
      string | { value: string; type: "PLAINTEXT" | "PARAMETER_STORE" | "SECRETS_MANAGER" }
    >;
    const envVars: EnvironmentVariable[] = Object.entries(rawEnvVars).map(([name, v]) =>
      typeof v === "string" ? { name, value: v, type: "PLAINTEXT" as const } : { name, value: v.value, type: v.type },
    );

    const startResult = await getCodeBuildClient(ctx.region).send(
      new StartBuildCommand({
        projectName: project_name,
        environmentVariablesOverride: envVars.length > 0 ? envVars : undefined,
        sourceVersion: config.source_version != null ? expectString(config.source_version, "source_version") : undefined,
      }),
      { abortSignal: ctx.signal },
    );

    const buildId = startResult.build?.id;
    if (!buildId) throw new Error("CodeBuild did not return a build ID");
    ctx.log("build started", { buildId });

    const timeoutMinutes = startResult.build?.timeoutInMinutes ?? 60;
    const deadline = Date.now() + timeoutMinutes * 60_000;

    const onAbort = async () => {
      ctx.log("cancelling build");
      try {
        await getCodeBuildClient(ctx.region).send(new StopBuildCommand({ id: buildId }));
        ctx.log("build cancel requested");
      } catch (e) {
        ctx.warn("failed to cancel build", { error: errorMessage(e) });
      }
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    try {
      let logNextToken: string | undefined;
      let logGroupName: string | undefined;
      let logStreamName: string | undefined;

      return await pollUntil({
        deadline,
        intervalMs: 5000,
        signal: ctx.signal,
        timeoutMessage: `Build exceeded ${timeoutMinutes}m timeout`,
        async poll() {
          const resp = await getCodeBuildClient(ctx.region).send(new BatchGetBuildsCommand({ ids: [buildId] }), {
            abortSignal: ctx.signal,
          });
          return resp.builds?.[0] ?? null;
        },
        async check(build) {
          if (!build) return { error: "Build not found" };

          if (!logGroupName && build.logs?.groupName) {
            logGroupName = build.logs.groupName;
            logStreamName = build.logs.streamName;
            ctx.log("log stream discovered", { logGroup: logGroupName, logStream: logStreamName });
          }
          if (logGroupName && logStreamName) {
            logNextToken = await streamLogs(logGroupName, logStreamName, logNextToken, ctx);
          }

          const status = build.buildStatus;
          if (status === "SUCCEEDED") {
            ctx.log("build completed successfully");
            return { done: true, output: { buildId, status: "SUCCEEDED" } };
          }
          if (status === "FAILED" || status === "FAULT" || status === "TIMED_OUT" || status === "STOPPED") {
            return {
              error: build.phases?.find((p) => p.phaseStatus === "FAILED")?.contexts?.[0]?.message ?? `build ${status}`,
            };
          }
          return "continue";
        },
        onProgress(build) {
          ctx.log("build in progress", { phase: build?.currentPhase ?? "UNKNOWN" });
        },
      });
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }
  },
});
