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

/** Maximum number of explicit refs accepted by a single log request. */
export const MAX_LOG_REFS = 32
/** Upper bound for a mutation rejection reason forwarded over RPC. */
export const MUTATION_REASON_MAX_LENGTH = 200

/**
 * Full object ids only, for values that are compared against the repository
 * state (`expectedHead` and mutation targets). Abbreviated ids are rejected so
 * a write can never be authorised by an ambiguous prefix.
 */
const FULL_COMMIT_HASH_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/

export function isFullCommitHash(value: string): boolean {
  return FULL_COMMIT_HASH_PATTERN.test(value)
}

export const FullCommitHashSchema = z.string().regex(FULL_COMMIT_HASH_PATTERN)

const SELECTABLE_REF_PREFIXES = ["refs/heads/", "refs/remotes/", "refs/tags/"] as const
/** Characters git forbids in a refname; also rejects option-looking input. */
const INVALID_REF_CHARS = /[\x00-\x20\x7f~^:?*[\\]/

function hasUnsafeRefSegments(value: string): boolean {
  if (value.includes("..") || value.includes("@{") || value.includes("//")) return true
  if (value.endsWith("/") || value.endsWith(".") || value.endsWith(".lock")) return true
  return value.split("/").some((segment) => segment.length === 0 || segment.startsWith(".") || segment.endsWith(".lock"))
}

/**
 * True for a fully-qualified ref the log method may select
 * (`refs/heads/*`, `refs/remotes/*`, `refs/tags/*`). Revision expressions,
 * globs and option-looking values are not canonical refnames.
 */
export function isCanonicalSelectableRef(value: string): boolean {
  if (value.length === 0 || value.length > 4096) return false
  if (value.startsWith("-") || INVALID_REF_CHARS.test(value)) return false
  const prefix = SELECTABLE_REF_PREFIXES.find((candidate) => value.startsWith(candidate))
  if (!prefix || value.length === prefix.length) return false
  return !hasUnsafeRefSegments(value.slice(prefix.length))
}

export const LogRefSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(isCanonicalSelectableRef, {
    message: "ref must be a canonical refs/heads/*, refs/remotes/* or refs/tags/* name",
  })

/**
 * Short branch/tag names (no `refs/` prefix) that cannot be parsed as an
 * option or as a git revision expression.
 */
export function isSafeShortRefName(value: string): boolean {
  if (typeof value !== "string") return false
  if (value.length === 0 || value.length > 255) return false
  if (value === "@" || value === "HEAD") return false
  if (value.startsWith("-") || value.startsWith("/") || value.startsWith("refs/")) return false
  if (INVALID_REF_CHARS.test(value)) return false
  return !hasUnsafeRefSegments(value)
}

const SafeShortRefSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(isSafeShortRefName, { message: "name must be a safe short refname" })

const MutationBase = {
  repositoryId: RepositoryIdSchema,
  expectedHead: FullCommitHashSchema.nullable(),
  confirmed: z.literal(true),
} as const

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
    refs: z.array(LogRefSchema).max(MAX_LOG_REFS).optional(),
    showRemotes: z.boolean().optional(),
    showTags: z.boolean().optional(),
    firstParent: z.boolean().optional(),
    order: z.enum(["date", "topo"]).optional(),
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

export const GetComparisonFilesInputSchema = z
  .object({
    repositoryId: RepositoryIdSchema,
    baseHash: CommitHashSchema,
    headHash: CommitHashSchema,
  })
  .strict()

export const GetComparisonFilesOutputSchema = z
  .object({ files: z.array(ChangedFileSchema) })
  .strict()

export const GetComparisonDiffInputSchema = z
  .object({
    repositoryId: RepositoryIdSchema,
    baseHash: CommitHashSchema,
    headHash: CommitHashSchema,
    path: SafeRelativePathSchema,
  })
  .strict()

export const GetComparisonDiffOutputSchema = FileDiffSchema

export const GitMutationResultSchema = z
  .object({
    status: GitStatusSchema,
    changed: z.boolean(),
    warning: z.string().optional(),
  })
  .strict()

export const CheckoutBranchInputSchema = z
  .object({
    ...MutationBase,
    branch: SafeShortRefSchema,
  })
  .strict()

export const CreateBranchInputSchema = z
  .object({
    ...MutationBase,
    name: SafeShortRefSchema,
    startPoint: FullCommitHashSchema,
    checkout: z.boolean().optional(),
  })
  .strict()

export const CreateTagInputSchema = z
  .object({
    ...MutationBase,
    name: SafeShortRefSchema,
    target: FullCommitHashSchema,
    message: z.string().max(10_000).optional(),
  })
  .strict()

export const RenameBranchInputSchema = z
  .object({
    ...MutationBase,
    oldName: SafeShortRefSchema,
    newName: SafeShortRefSchema,
  })
  .strict()

export const DeleteBranchInputSchema = z
  .object({
    ...MutationBase,
    name: SafeShortRefSchema,
  })
  .strict()

export const DeleteTagInputSchema = z
  .object({
    ...MutationBase,
    name: SafeShortRefSchema,
  })
  .strict()

/** Expected failures shared by all repository methods. Error messages never
 * include filesystem paths outside the repository id supplied by the caller.
 */
export const GitGraphErrorSchemas = {
  repository_not_found: z.object({ repositoryId: z.string() }).strict(),
  invalid_input: z.object({ reason: z.string() }).strict(),
  git_failed: z.object({ operation: z.string() }).strict(),
  disposed: z.object({}).strict(),
} as const

/**
 * Writes add a single rejection error carrying only a bounded reason. The
 * engine may add new reason values without changing this contract; details
 * such as stderr or filesystem paths are never forwarded.
 */
export const GitGraphMutationErrorSchemas = {
  ...GitGraphErrorSchemas,
  mutation_rejected: z
    .object({ reason: z.string().min(1).max(MUTATION_REASON_MAX_LENGTH) })
    .strict(),
} as const

const errors = GitGraphErrorSchemas
const mutationErrors = GitGraphMutationErrorSchemas

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
    getComparisonFiles: {
      input: GetComparisonFilesInputSchema,
      output: GetComparisonFilesOutputSchema,
      errors,
    },
    getComparisonDiff: {
      input: GetComparisonDiffInputSchema,
      output: GetComparisonDiffOutputSchema,
      errors,
    },
    checkoutBranch: {
      input: CheckoutBranchInputSchema,
      output: GitMutationResultSchema,
      errors: mutationErrors,
    },
    createBranch: {
      input: CreateBranchInputSchema,
      output: GitMutationResultSchema,
      errors: mutationErrors,
    },
    createTag: {
      input: CreateTagInputSchema,
      output: GitMutationResultSchema,
      errors: mutationErrors,
    },
    renameBranch: {
      input: RenameBranchInputSchema,
      output: GitMutationResultSchema,
      errors: mutationErrors,
    },
    deleteBranch: {
      input: DeleteBranchInputSchema,
      output: GitMutationResultSchema,
      errors: mutationErrors,
    },
    deleteTag: {
      input: DeleteTagInputSchema,
      output: GitMutationResultSchema,
      errors: mutationErrors,
    },
  },
  events: {},
})
