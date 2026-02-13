import {
  UpdateServiceCommand,
  DescribeServicesCommand,
} from "@aws-sdk/client-ecs";
import type { EcsRestartActionConfig } from "../../config/types.ts";
import type { ActionContext } from "../types.ts";
import { getEcsClient, pollUntil } from "./aws-utils.ts";

export async function executeEcsRestart(config: EcsRestartActionConfig, ctx: ActionContext) {
  const { cluster, services, timeout = 600 } = config;

  ctx.log("restarting services", { cluster, serviceCount: services.length });

  for (const service of services) {
    ctx.log("forcing new deployment", { service });
    await getEcsClient(ctx.region).send(
      new UpdateServiceCommand({
        cluster,
        service,
        forceNewDeployment: true,
      }),
      { abortSignal: ctx.signal },
    );
  }

  ctx.log("waiting for services to stabilize");

  return pollUntil({
    deadline: Date.now() + timeout * 1000,
    intervalMs: 15000,
    signal: ctx.signal,
    timeoutMessage: `Timeout waiting for services to stabilize after ${timeout}s`,
    async poll() {
      return getEcsClient(ctx.region).send(
        new DescribeServicesCommand({ cluster, services }),
        { abortSignal: ctx.signal },
      );
    },
    check(resp) {
      const allStable = resp.services?.every((svc) => {
        const primary = svc.deployments?.find(d => d.status === "PRIMARY");
        return primary && primary.runningCount === primary.desiredCount && svc.deployments?.length === 1;
      });

      if (allStable) {
        ctx.log("all services stabilized");
        return { done: true, output: { cluster, services, status: "stable" } };
      }
      return "continue";
    },
    onProgress(resp) {
      for (const svc of resp.services ?? []) {
        const primary = svc.deployments?.find(d => d.status === "PRIMARY");
        ctx.log("service status poll", {
          service: svc.serviceName,
          running: primary?.runningCount,
          desired: primary?.desiredCount,
          deployments: svc.deployments?.length,
        });
      }
    },
  });
}
