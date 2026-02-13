import {
  RunTaskCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import type { EcsTaskActionConfig } from "../../config/types.ts";
import type { ActionContext } from "../types.ts";
import { getEcsClient, pollUntil, streamLogs } from "./aws-utils.ts";

export async function executeEcsTask(config: EcsTaskActionConfig, ctx: ActionContext) {
  const { cluster, task_definition, container_name, command, subnets, security_groups, launch_type = "FARGATE", assign_public_ip = false, timeout = 600 } = config;

  ctx.log("running ecs task", { taskDefinition: task_definition, container: container_name, command: command.join(" ") });

  const runResult = await getEcsClient(ctx.region).send(
    new RunTaskCommand({
      cluster,
      taskDefinition: task_definition,
      overrides: {
        containerOverrides: [
          { name: container_name, command },
        ],
      },
      launchType: launch_type,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups: security_groups,
          assignPublicIp: assign_public_ip ? "ENABLED" : "DISABLED",
        },
      },
      count: 1,
    }),
    { abortSignal: ctx.signal },
  );

  const taskArn = runResult.tasks?.[0]?.taskArn;
  if (!taskArn) {
    const failureReason = runResult.failures?.[0]?.reason ?? "unknown";
    throw new Error(`Failed to start ECS task: ${failureReason}`);
  }

  ctx.log("task started", { taskArn });

  const taskId = taskArn.split("/").pop()!;
  let logNextToken: string | undefined;

  return pollUntil({
    deadline: Date.now() + timeout * 1000,
    intervalMs: 10000,
    signal: ctx.signal,
    timeoutMessage: `Timeout waiting for ECS task after ${timeout}s`,
    async poll() {
      const resp = await getEcsClient(ctx.region).send(
        new DescribeTasksCommand({ cluster, tasks: [taskArn] }),
        { abortSignal: ctx.signal },
      );
      return resp.tasks?.[0] ?? null;
    },
    async check(task) {
      if (!task) return { error: "Task not found" };

      if (task.containers?.[0]) {
        const logGroup = config.log_group ?? `/ecs/${task_definition.split(":")[0]}`;
        const logStreamPrefix = config.log_stream_prefix ?? `ecs/${container_name}`;
        logNextToken = await streamLogs(logGroup, `${logStreamPrefix}/${taskId}`, logNextToken, ctx);
      }

      if (task.lastStatus === "STOPPED") {
        const exitCode = task.containers?.[0]?.exitCode;
        if (exitCode === 0) {
          ctx.log("task completed successfully");
          return { done: true, output: { taskArn, exitCode: 0 } };
        }
        return { error: task.stoppedReason ?? task.containers?.[0]?.reason ?? `task failed with exit code ${exitCode}` };
      }
      return "continue";
    },
    onProgress(task) {
      ctx.log("task status poll", { taskStatus: task?.lastStatus });
    },
  });
}
