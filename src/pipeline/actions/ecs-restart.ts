import { DescribeServicesCommand, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import {
  defineAction,
  expectNumber,
  expectString,
  expectStringArray,
  numberOrTemplate,
  stringArrayOrTemplate,
  stringOrTemplate,
  z,
} from "../types.ts";
import { getEcsClient, pollUntil } from "./aws-utils.ts";

const schema = z
  .object({
    cluster: stringOrTemplate,
    services: stringArrayOrTemplate,
    timeout: numberOrTemplate.optional(),
  })
  .strict();

export default defineAction({
  name: "ecs-restart",
  schema,
  handler: async (config, ctx) => {
    const cluster = expectString(config.cluster, "cluster");
    const services = expectStringArray(config.services, "services");
    const timeout = config.timeout != null ? expectNumber(config.timeout, "timeout") : 600;

    ctx.log("restarting services", { cluster, serviceCount: services.length });

    for (const service of services) {
      ctx.log("forcing new deployment", { service });
      await getEcsClient(ctx.region).send(new UpdateServiceCommand({ cluster, service, forceNewDeployment: true }), {
        abortSignal: ctx.signal,
      });
    }

    ctx.log("waiting for services to stabilize");

    return pollUntil({
      deadline: Date.now() + timeout * 1000,
      intervalMs: 15000,
      signal: ctx.signal,
      timeoutMessage: `Timeout waiting for services to stabilize after ${timeout}s`,
      async poll() {
        return getEcsClient(ctx.region).send(new DescribeServicesCommand({ cluster, services }), {
          abortSignal: ctx.signal,
        });
      },
      check(resp) {
        const allStable = resp.services?.every((svc) => {
          const primary = svc.deployments?.find((d) => d.status === "PRIMARY");
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
          const primary = svc.deployments?.find((d) => d.status === "PRIMARY");
          ctx.log("service status poll", {
            service: svc.serviceName,
            running: primary?.runningCount,
            desired: primary?.desiredCount,
            deployments: svc.deployments?.length,
          });
        }
      },
    });
  },
});
