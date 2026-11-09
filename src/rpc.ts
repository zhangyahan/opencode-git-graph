import { z } from "zod"
import { Rpc } from "@opencode/plugin/rpc"

/**
 * Portable RPC contract shared by the server and GUI halves of the plugin.
 *
 * The server registers handlers with `ctx.rpc.register(GitGraphRpc, ...)` and the
 * GUI calls them through `ctx.client.rpc(GitGraphRpc)`.
 *
 * Every schema is exported so the GUI can validate/parse data locally without
 * duplicating the contract.
 */

const STATUS_VALUES = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "conflicted",
] as const

const REF_KINDS = ["branch", "remote", "tag", "head"] as const
const REPOSITORY_TYPES = ["normal", "worktree", "submodule"] as const

/** An integer between `min` and `max` (inclusive). */
function integerInRange(min: number, max: number) {
  return z.number().int().min(min).max(max)
}

export const ChangeCountsSchema = z
  .object({
    staged: integerInRange(0, Number.MAX_SAFE_INTEGER),
    unstaged: integerInRange(0, Number.MAX_SAFE_INTEGER),
    untracked: integerInRange(0, Number.MAX_SAFE_INTEGER),
    conflicted: integerInRange(0, Number.MAX_SAFE_INTEGER),
  })
  .strict()

export const ChangedFileSchema = z
  .object({
    path: z.string().min(1),
    oldPath: z.string().min(1).optional(),
    status: z.enum(STATUS_VALUES),
    staged: z.boolean(),
  })
  .strict()

export const GitRepositorySchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    rootPath: z.string().min(1),
    gitDir: z.string().min(1),
    type: z.enum(REPOSITORY_TYPES),
    branch: z.string().nullable(),
    head: z.string().nullable(),
    detached: z.boolean(),
    changes: ChangeCountsSchema,
  })
  .strict()

export const GitStatusSchema = z
  .object({
    repositoryId: z.string().min(1),
    branch: z.string().nullable(),
    head: z.string().nullable(),
    detached: z.boolean(),
    files: z.array(ChangedFileSchema),
    counts: ChangeCountsSchema,
  })
  .strict()

export const GitCommitSchema = z
  .object({
    hash: z.string().min(1),
    parents: z.array(z.string()),
    author: z.string(),
    authorDate: z.string(),
    subject: z.string(),
    refs: z.array(z.string()),
  })
  .strict()

export const GitRefSchema = z
  .object({
    name: z.string().min(1),
    hash: z.string().min(1),
    kind: z.enum(REF_KINDS),
  })
  .strict()

export const GitTargetSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("commit"),
      hash: z.string().regex(/^[0-9a-fA-F]{4,64}$/),
      parentIndex: z.number().int().min(0).optional(),
    })
    .strict(),
  z.object({ type: z.literal("index") }).strict(),
  z.object({ type: z.literal("working-tree") }).strict(),
])

export const FileDiffSchema = z
  .object({
    path: z.string().min(1),
    status: z.enum(STATUS_VALUES),
    oldPath: z.string().min(1).optional(),
    text: z.string(),
    binary: z.boolean(),
    truncated: z.boolean().optional(),
  })
  .strict()

/** Repository identifiers are normalized absolute working-tree paths. */
export const RepositoryIdSchema = z.string().min(1).max(4096)

/**
 * Revisions are accepted as full/abbreviated object ids only. Git revision
 * expressions such as `HEAD~1` or option-looking strings such as `--all` are
 * intentionally rejected so callers cannot redirect git to another object.
 */
const COMMIT_HASH_PATTERN = /^[0-9a-fA-F]{4,64}$/

export const CommitHashSchema = z.string().regex(COMMIT_HASH_PATTERN)

export function isCommitHash(value: string): boolean {
  return COMMIT_HASH_PATTERN.test(value)
}

/**
 * Accept only repository-relative paths without traversal segments, absolute
 * prefixes or Windows separators. This is intentionally portable (no node:path)
 * because the contract is imported by the GUI as well as the server.
 */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 4096) return false
  if (value.includes("\0")) return false
  if (value.includes("\\")) return false
  if (value.startsWith("/")) return false
  if (/^[A-Za-z]:/.test(value)) return false

  const segments = value.split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

export const SafeRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(isSafeRelativePath, { message: "path must be a safe repository-relative path" })

export const ListRepositoriesInputSchema = z
  .object({ refresh: z.boolean().optional() })
  .strict()
  .default({})

export const ListRepositoriesOutputSchema = z
  .object({ repositories: z.array(GitRepositorySchema) })
  .strict()

export const GetStatusInputSchema = z.object({ repositoryId: RepositoryIdSchema }).strict()

export const GetStatusOutputSchema = GitStatusSchema

export const GetLogInputSchema = z
  .object({
    repositoryId: RepositoryIdSchema,
    limit: z.number().int().min(1).max(1000).optional(),
    skip: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict()

export const GetLogOutputSchema = z
  .object({
    commits: z.array(GitCommitSchema),
    hasMore: z.boolean(),
  })
  .strict()

export const GetRefsInputSchema = z.object({ repositoryId: RepositoryIdSchema }).strict()

export const GetRefsOutputSchema = z.object({ refs: z.array(GitRefSchema) }).strict()

export const GetCommitFilesInputSchema = z
  .object({
    repositoryId: RepositoryIdSchema,
    hash: CommitHashSchema,
    parentIndex: z.number().int().min(0).optional(),
  })
  .strict()

export const GetCommitFilesOutputSchema = z
  .object({ files: z.array(ChangedFileSchema) })
  .strict()

export const GetDiffInputSchema = z
  .object({
    repositoryId: RepositoryIdSchema,
    target: GitTargetSchema,
    path: SafeRelativePathSchema,
  })
  .strict()

export const GetDiffOutputSchema = FileDiffSchema

/**
 * Expected failures shared by all repository methods. Error messages never
 * include filesystem paths outside the repository id supplied by the caller.
 */
export const GitGraphErrorSchemas = {
  repository_not_found: z.object({ repositoryId: z.string() }).strict(),
  invalid_input: z.object({ reason: z.string() }).strict(),
  git_failed: z.object({ operation: z.string() }).strict(),
  disposed: z.object({}).strict(),
} as const

const errors = GitGraphErrorSchemas

export const GitGraphRpc = Rpc.define({
  id: "git-graph",
  methods: {
    ping: {
      input: z.object({ message: z.string().optional() }).strict(),
      output: z.object({ ok: z.literal(true), message: z.string() }).strict(),
    },
    listRepositories: {
      input: ListRepositoriesInputSchema,
      output: ListRepositoriesOutputSchema,
      errors,
    },
    getStatus: {
      input: GetStatusInputSchema,
      output: GetStatusOutputSchema,
      errors,
    },
    getLog: {
      input: GetLogInputSchema,
      output: GetLogOutputSchema,
      errors,
    },
    getRefs: {
      input: GetRefsInputSchema,
      output: GetRefsOutputSchema,
      errors,
    },
    getCommitFiles: {
      input: GetCommitFilesInputSchema,
      output: GetCommitFilesOutputSchema,
      errors,
    },
    getDiff: {
      input: GetDiffInputSchema,
      output: GetDiffOutputSchema,
      errors,
    },
  },
  events: {},
})
