import { z } from "zod"

export const AccessLevel = z.enum(["write", "read", "none"])
export const PrivacyDefaults = z
  .object({
    project: AccessLevel.default("write"),
    folder: AccessLevel.default("read"),
    externalProcessing: z.boolean().default(true),
  })
  .strict()
export type PrivacyDefaults = z.infer<typeof PrivacyDefaults>

export const ProjectControls = z
  .object({
    providers: z.array(z.string().trim().min(1).max(200)).max(100).nullable().default(null),
    commands: z.boolean().default(true),
    networkTools: z.boolean().default(true),
    isolate: z.boolean().default(false),
    sourceAccess: z.record(z.string(), AccessLevel).default({}),
    sourceFolders: z.array(z.string().min(1).max(4096)).max(100).default([]),
    // Explicit unrestricted entries retain their custom/inherited UI state. Parent restrictions still apply.
    customAccess: z.array(z.string().trim().min(1)).max(200).optional(),
    readOnly: z.array(z.string().trim().min(1)).max(200).default([]),
    excluded: z.array(z.string().trim().min(1)).max(200).default([]),
    deviceOnly: z.array(z.string().trim().min(1)).max(200).default([]),
    origins: z.record(z.string(), z.array(z.string().url())).default({}),
    connections: z.array(z.string().min(1)).nullable().default(null),
    retainRequests: z.boolean().default(false),
    localConcurrency: z.number().int().min(1).max(8).default(1),
    memory: z.string().max(32000).default(""),
  })
  .strict()

export type ProjectControls = z.infer<typeof ProjectControls>
export type ProjectControlsPlatform = {
  lifecycle(input: {
    directory: string
    projectID?: string
    action: "preview" | "delete" | "relocate"
    target?: string
    token?: string
  }): Promise<{ count: number; token: string; directory: string; busy: boolean; removedProjectID: string }>

  defaults(): Promise<PrivacyDefaults>
  saveDefaults(value: PrivacyDefaults): Promise<void>
  entries(
    directory: string,
    relative: string,
    offset?: number,
  ): Promise<{ entries: Array<{ name: string; path: string; directory: boolean; symlink: boolean }>; more: boolean }>
  folders(paths: string[]): Promise<Array<{ path: string; available: boolean }>>
  requests(directory: string): Promise<RequestRecord[]>
  removeRecord(directory: string, kind: "requests" | "cases" | "results", id: string): Promise<void>
  cases(directory: string): Promise<EvaluationCase[]>
  results(directory: string): Promise<EvaluationResult[]>
  saveCase(directory: string, value: EvaluationCase): Promise<void>
  saveResult(directory: string, value: EvaluationResult): Promise<void>
  compare(sessionID: string): Promise<void>
  read(directory: string): Promise<ProjectControls>
  save(directory: string, value: ProjectControls): Promise<void>
}

export const RequestRecord = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
    time: z.number(),
    sessionID: z.string(),
    provider: z.string(),
    model: z.string(),
    origin: z.string(),
    allowed: z.boolean(),
    reason: z.string().optional(),
    content: z.string().max(2000000).optional(),
  })
  .strict()
export type RequestRecord = z.infer<typeof RequestRecord>
export const EvaluationCase = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
    time: z.number(),
    name: z.string().min(1).max(200),
    prompt: z.string().min(1).max(32000),
    expected: z.string().max(32000).default(""),
    context: z.string().max(100000).default(""),
    criteria: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
    match: z.enum(["contains", "exact", "review"]).default("review"),
  })
  .strict()
export type EvaluationCase = z.infer<typeof EvaluationCase>
export const EvaluationAssessment = z
  .object({
    assessments: z
      .array(
        z
          .object({
            criterion: z.string().max(2000),
            verdict: z.enum(["pass", "fail", "uncertain"]),
            reason: z.string().min(1).max(16000),
            evidence: z.string().max(16000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict()

export const EvaluationResult = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
    time: z.number(),
    caseID: z.string(),
    sessionID: z.string(),
    provider: z.string(),
    model: z.string(),
    output: z.string().max(2000000),
    passed: z.boolean().nullable(),
    runID: z.string().optional(),
    caseName: z.string().optional(),
    snapshot: EvaluationCase.optional(),
    policy: ProjectControls.optional(),
    review: z
      .object({ verdict: z.enum(["pass", "fail", "unreviewed"]), note: z.string().max(32000), time: z.number() })
      .optional(),
    assessments: z
      .array(
        z.object({
          criterion: z.string(),
          verdict: z.enum(["pass", "fail", "uncertain"]),
          reason: z.string(),
          evidence: z.string(),
        }),
      )
      .max(30)
      .optional(),
    judge: z.object({ providerID: z.string(), id: z.string() }).optional(),
    judgeSessionID: z.string().optional(),
    judgeError: z.string().optional(),
    duration: z.number(),
    prompt: z.string(),
    expected: z.string(),
    error: z.string().optional(),
  })
  .strict()
export type EvaluationResult = z.infer<typeof EvaluationResult>
