interface ForkTestRequest {
  readonly event: string;
  readonly base: string | undefined;
  readonly files: readonly string[];
}

interface ForkTestPlan {
  readonly mode: "core" | "related";
  readonly commands: readonly (readonly string[])[];
}

export function planForkTests(request: ForkTestRequest): ForkTestPlan;
