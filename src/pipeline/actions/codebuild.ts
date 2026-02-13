import {
  CodeBuildClient,
  StartBuildCommand,
  StopBuildCommand,
  BatchGetBuildsCommand,
  type EnvironmentVariable,
} from "@aws-sdk/client-codebuild";
import type { CodeBuildActionConfig } from "../../config/types.ts";
import type { ActionContext } from "../types.ts";
import { errorMessage } from "../../types.ts";
import { lazyClient, pollUntil, streamLogs } from "./aws-utils.ts";

const getCodeBuildClient = lazyClient((region) => new CodeBuildClient({ region }));

export async function executeCodeBuild(config: CodeBuildActionConfig, ctx: ActionContext) {
  ctx.log("starting codebuild project", { project: config.project_name });

  const envVars: EnvironmentVariable[] = Object.entries(config.env_vars ?? {}).map(
    ([name, v]) => typeof v === "string"
      ? { name, value: v, type: "PLAINTEXT" as const }
      : { name, value: v.value, type: v.type },
  );

  const startResult = await getCodeBuildClient(ctx.region).send(
    new StartBuildCommand({
      projectName: config.project_name,
      environmentVariablesOverride: envVars.length > 0 ? envVars : undefined,
      sourceVersion: config.source_version,
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
        const resp = await getCodeBuildClient(ctx.region).send(
          new BatchGetBuildsCommand({ ids: [buildId] }),
          { abortSignal: ctx.signal },
        );
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
          return { error: build.phases?.find(p => p.phaseStatus === "FAILED")?.contexts?.[0]?.message ?? `build ${status}` };
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
}
