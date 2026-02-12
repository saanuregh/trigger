import {
  RunTaskCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import type { EcsTaskActionConfig } from "../../config/types.ts";
import type { ActionContext } from "../types.ts";
import { getEcsClient, sleep, streamLogs } from "./aws-utils.ts";

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

  const deadline = Date.now() + timeout * 1000;
  let logNextToken: string | undefined;

  const taskId = taskArn.split("/").pop()!;

  while (Date.now() < deadline) {
    await sleep(10000, ctx.signal);

    const descResp = await getEcsClient(ctx.region).send(
      new DescribeTasksCommand({ cluster, tasks: [taskArn] }),
      { abortSignal: ctx.signal },
    );

    const task = descResp.tasks?.[0];
    if (!task) throw new Error("Task not found");

    const container = task.containers?.[0];
    if (container) {
      const logGroup = config.log_group ?? `/ecs/${task_definition.split(":")[0]}`;
      const logStreamPrefix = config.log_stream_prefix ?? `ecs/${container_name}`;
      const logStream = `${logStreamPrefix}/${taskId}`;
      logNextToken = await streamLogs(logGroup, logStream, logNextToken, ctx);
    }

    const lastStatus = task.lastStatus;
    ctx.log("task status poll", { taskStatus: lastStatus });

    if (lastStatus === "STOPPED") {
      const exitCode = task.containers?.[0]?.exitCode;
      const reason = task.stoppedReason ?? task.containers?.[0]?.reason;

      if (exitCode === 0) {
        ctx.log("task completed successfully");
        return { output: { taskArn, exitCode: 0 } };
      }

      throw new Error(reason ?? `task failed with exit code ${exitCode}`);
    }
  }

  throw new Error(`Timeout waiting for ECS task after ${timeout}s`);
}
