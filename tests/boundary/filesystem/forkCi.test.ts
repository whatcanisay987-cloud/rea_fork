import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { planForkTests } from "../../../scripts/ci/fork-checks.mjs";

const base = "a".repeat(40);
const workflowSchema = z.object({
  on: z.record(z.string(), z.unknown()),
  jobs: z.record(z.string(), z.unknown()),
});

it("selects affected source tests and directly changed boundary tests", () => {
  const path = "tests/boundary/process/processDescendantPidAdapters.test.ts";
  expect(
    planForkTests({ event: "push", base, files: ["src/cli.ts", path, path] }),
  ).toEqual({
    mode: "related",
    commands: [
      ["scripts/run-development-tests.mjs", "changed", "--base", base],
      ["scripts/run-development-tests.mjs", "focused", path],
    ],
  });
});

it.each(["schedule", "workflow_dispatch"])(
  "runs core regression for %s",
  (event) => {
    const plan = planForkTests({ event, base, files: [] });
    expect(plan.mode).toBe("core");
    expect(plan.commands[0]).toEqual(["scripts/ci/test-group.mjs", "source"]);
    expect(plan.commands[1]).toEqual([
      "scripts/run-development-tests.mjs",
      "focused",
      "tests/boundary/filesystem/forkCi.test.ts",
      "tests/boundary/filesystem/ciPrHealth.test.ts",
      "tests/boundary/process/processDescendantPidAdapters.test.ts",
      "tests/boundary/process/releaseArtifactCanary.test.ts",
    ]);
  },
);

it("does not run source test files twice", () => {
  expect(
    planForkTests({
      event: "push",
      base,
      files: ["src/domain/process/processCapture.comparison.test.ts"],
    }).commands,
  ).toEqual([["scripts/run-development-tests.mjs", "changed", "--base", base]]);
});

it.each([undefined, "", "0".repeat(40), "--all"])(
  "falls back to core for unavailable base %s",
  (invalid) => {
    expect(
      planForkTests({ event: "push", base: invalid, files: [] }).mode,
    ).toBe("core");
  },
);

it("checks fork policy when CI configuration changes", () => {
  const plan = planForkTests({
    event: "pull_request",
    base,
    files: [".github/workflows/fork-ci.yml"],
  });
  expect(plan.commands[1]).toEqual([
    "scripts/run-development-tests.mjs",
    "focused",
    "tests/boundary/filesystem/forkCi.test.ts",
  ]);
});

it("has one automatic workflow and one daily schedule, with large lanes available manually", async () => {
  const root = new URL("../../../.github/workflows/", import.meta.url);
  const workflows = await Promise.all(
    (await readdir(root))
      .filter((file) => file.endsWith(".yml"))
      .map(async (file) => ({
        file,
        workflow: workflowSchema.parse(
          parse(await readFile(new URL(file, root), "utf8")),
        ),
      })),
  );
  const automatic = workflows.filter(({ workflow }) =>
    Object.keys(workflow.on).some((event) =>
      ["push", "pull_request", "pull_request_target", "schedule"].includes(
        event,
      ),
    ),
  );
  expect(automatic.map(({ file }) => file)).toEqual(["fork-ci.yml"]);
  const fork = z
    .object({
      on: z.object({ schedule: z.array(z.object({ cron: z.string() })) }),
      permissions: z.record(z.string(), z.string()),
      jobs: z.object({
        core: z.object({
          strategy: z.unknown().optional(),
          "continue-on-error": z.unknown().optional(),
          steps: z.array(z.object({ run: z.string().optional() })),
        }),
      }),
    })
    .parse(parse(await readFile(new URL("fork-ci.yml", root), "utf8")));
  expect(fork.on.schedule).toEqual([{ cron: "23 19 * * *" }]);
  expect(fork.permissions).toEqual({ contents: "read" });
  expect(Object.keys(fork.jobs)).toEqual(["core"]);
  expect(fork.jobs.core.strategy).toBeUndefined();
  expect(fork.jobs.core["continue-on-error"]).toBeUndefined();
  expect(fork.jobs.core.steps.map((step) => step.run).filter(Boolean)).toEqual([
    "npm ci",
    "npm run check:ci:fast",
    "npm run build:cached",
    "node scripts/ci/fork-checks.mjs",
  ]);
  const full = workflowSchema.parse(
    workflows.find(({ file }) => file === "ci.yml")?.workflow,
  );
  expect(Object.keys(full.on).sort()).toEqual([
    "workflow_call",
    "workflow_dispatch",
  ]);
});
