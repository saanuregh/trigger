import { DescribeTasksCommand, RunTaskCommand } from "@aws-sdk/client-ecs";
import {
  booleanOrTemplate,
  defineAction,
  expectBoolean,
  expectEnum,
  expectNumber,
  expectString,
  expectStringArray,
  numberOrTemplate,
  stringArrayOrTemplate,
  stringOrTemplate,
  z,
} from "../types.ts";
import { getEcsClient, pollUntil, streamLogs } from "./aws-utils.ts";

const schema = z
  .object({
    cluster: stringOrTemplate,
    task_definition: stringOrTemplate,
    container_name: stringOrTemplate,
    command: stringArrayOrTemplate,
    subnets: stringArrayOrTemplate,
    security_groups: stringArrayOrTemplate,
    launch_type: z.enum(["FARGATE", "EC2"]).optional(),
    assign_public_ip: booleanOrTemplate.optional(),
    timeout: numberOrTemplate.optional(),
    log_group: stringOrTemplate.optional(),
    log_stream_prefix: stringOrTemplate.optional(),
  })
  .strict();

export default defineAction({
  name: "ecs-task",
  schema,
  handler: async (config, ctx) => {
    const cluster = expectString(config.cluster, "cluster");
    const task_definition = expectString(config.task_definition, "task_definition");
    const container_name = expectString(config.container_name, "container_name");
    const command = expectStringArray(config.command, "command");
    const subnets = expectStringArray(config.subnets, "subnets");
    const security_groups = expectStringArray(config.security_groups, "security_groups");
    const launch_type = config.launch_type != null ? expectEnum(config.launch_type, "launch_type", ["FARGATE", "EC2"] as const) : "FARGATE";
    const assign_public_ip = config.assign_public_ip != null ? expectBoolean(config.assign_public_ip, "assign_public_ip") : false;
    const timeout = config.timeout != null ? expectNumber(config.timeout, "timeout") : 600;

    ctx.log("running ecs task", {
      taskDefinition: task_definition,
      container: container_name,
      command: command.join(" "),
    });

    const runResult = await getEcsClient(ctx.region).send(
      new RunTaskCommand({
        cluster,
        taskDefinition: task_definition,
        overrides: {
          containerOverrides: [{ name: container_name, command }],
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
        const resp = await getEcsClient(ctx.region).send(new DescribeTasksCommand({ cluster, tasks: [taskArn] }), {
          abortSignal: ctx.signal,
        });
        return resp.tasks?.[0] ?? null;
      },
      async check(task) {
        if (!task) return { error: "Task not found" };

        if (task.containers?.[0]) {
          const logGroup = config.log_group != null ? expectString(config.log_group, "log_group") : `/ecs/${task_definition.split(":")[0]}`;
          const logStreamPrefix =
            config.log_stream_prefix != null ? expectString(config.log_stream_prefix, "log_stream_prefix") : `ecs/${container_name}`;
          logNextToken = await streamLogs(logGroup, `${logStreamPrefix}/${taskId}`, logNextToken, ctx);
        }

        if (task.lastStatus === "STOPPED") {
          const exitCode = task.containers?.[0]?.exitCode;
          if (exitCode === 0) {
            ctx.log("task completed successfully");
            return { done: true, output: { taskArn, exitCode: 0 } };
          }
          return {
            error: task.stoppedReason ?? task.containers?.[0]?.reason ?? `task failed with exit code ${exitCode}`,
          };
        }
        return "continue";
      },
      onProgress(task) {
        ctx.log("task status poll", { taskStatus: task?.lastStatus });
      },
    });
  },
});
