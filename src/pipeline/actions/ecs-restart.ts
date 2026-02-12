import {
  UpdateServiceCommand,
  DescribeServicesCommand,
} from "@aws-sdk/client-ecs";
import type { EcsRestartActionConfig } from "../../config/types.ts";
import type { ActionContext } from "../types.ts";
import { getEcsClient, sleep } from "./aws-utils.ts";

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
  const deadline = Date.now() + timeout * 1000;

  while (Date.now() < deadline) {
    await sleep(15000, ctx.signal);

    const resp = await getEcsClient(ctx.region).send(
      new DescribeServicesCommand({ cluster, services }),
      { abortSignal: ctx.signal },
    );

    const allStable = resp.services?.every((svc) => {
      const primary = svc.deployments?.find(d => d.status === "PRIMARY");
      return primary && primary.runningCount === primary.desiredCount && svc.deployments?.length === 1;
    });

    if (allStable) {
      ctx.log("all services stabilized");
      return { output: { cluster, services, status: "stable" } };
    }

    for (const svc of resp.services ?? []) {
      const primary = svc.deployments?.find(d => d.status === "PRIMARY");
      ctx.log("service status poll", {
        service: svc.serviceName,
        running: primary?.runningCount,
        desired: primary?.desiredCount,
        deployments: svc.deployments?.length,
      });
    }
  }

  throw new Error(`Timeout waiting for services to stabilize after ${timeout}s`);
}
