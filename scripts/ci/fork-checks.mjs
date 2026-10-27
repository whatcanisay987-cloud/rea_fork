import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { projectForTest } from "../lib/test-projects.mjs";

const CORE_BOUNDARIES = [
  "tests/boundary/filesystem/forkCi.test.ts",
  "tests/boundary/filesystem/ciPrHealth.test.ts",
  "tests/boundary/process/processDescendantPidAdapters.test.ts",
  "tests/boundary/process/releaseArtifactCanary.test.ts",
];
const usableBase = (base) =>
  /^[a-f0-9]{40}$/u.test(base ?? "") && !/^0+$/u.test(base);

/** The fork's explicit core scope, independent of upstream qualification. */
export function planForkTests({ event, base, files }) {
  if (["schedule", "workflow_dispatch"].includes(event) || !usableBase(base))
    return {
      mode: "core",
      commands: [
        ["scripts/ci/test-group.mjs", "source"],
        ["scripts/run-development-tests.mjs", "focused", ...CORE_BOUNDARIES],
      ],
    };
  const direct = files.filter(
    (file) =>
      /^(src|tests)\/.+\.test\.ts$/u.test(file) &&
      !/[\\\0\r\n]/u.test(file) &&
      file.split("/").every((part) => part && part !== "." && part !== "..") &&
      projectForTest(file).group === "built",
  );
  if (files.some((file) => /^(\.github\/|scripts\/ci\/)/u.test(file)))
    direct.push(CORE_BOUNDARIES[0]);
  return {
    mode: "related",
    commands: [
      ["scripts/run-development-tests.mjs", "changed", "--base", base],
      ...(direct.length
        ? [["scripts/run-development-tests.mjs", "focused", ...new Set(direct)]]
        : []),
    ],
  };
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (
    !["push", "pull_request", "schedule", "workflow_dispatch"].includes(event)
  )
    throw new Error(`Unsupported fork CI event: ${event}`);
  let base = process.env.CI_FORK_BASE;
  let files = [];
  if (usableBase(base) && ["push", "pull_request"].includes(event)) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", base, "HEAD"]);
      files = execFileSync(
        "git",
        [
          "diff",
          "--name-only",
          "--no-renames",
          "--diff-filter=ACMR",
          "-z",
          base,
          "HEAD",
        ],
        { encoding: "utf8" },
      )
        .split("\0")
        .filter((file) => file && existsSync(file));
    } catch {
      // First pushes, rewritten history and unavailable bases get core coverage.
      base = undefined;
    }
  }
  const plan = planForkTests({ event, base, files });
  console.log(JSON.stringify(plan));
  for (const args of plan.commands) {
    const result = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
