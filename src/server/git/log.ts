import type { GitCommit } from "../../shared/types.js"
import { git, GitError, type GitSignalOptions } from "./executor.js"
import { GitInputError, assertLogLimit, assertLogSkip } from "./validation.js"

const LOG_FORMAT = "%H%x00%P%x00%an%x00%aI%x00%s%x00%D"
const REF_FORMAT = "%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)"

/** Maximum number of explicitly selected refs accepted by a single log call. */
const MAX_LOG_REFS = 32

const HEADS_PREFIX = "refs/heads/"
const REMOTES_PREFIX = "refs/remotes/"
const TAGS_PREFIX = "refs/tags/"
const SELECTABLE_REF_PREFIXES = [HEADS_PREFIX, REMOTES_PREFIX, TAGS_PREFIX]

/** Characters git forbids in a refname; also rejects option-looking input. */
const INVALID_REF_CHARS = /[\x00-\x20\x7f~^:?*[\\]/

export interface LogOptions {
  limit?: number
  skip?: number
  signal?: AbortSignal
  /**
   * Fully-qualified refs to walk (`refs/heads/*`, `refs/remotes/*` or
   * `refs/tags/*`), at most {@link MAX_LOG_REFS}. Names are validated against
   * the repository's effective `git for-each-ref` allowlist, so unknown refs,
   * globs and revision expressions are rejected. An empty array (or omitting
   * the option) means "All".
   *
   * Explicit refs always take priority over `showRemotes`/`showTags`: a
   * selected remote ref is walked even when `showRemotes` is false.
   */
  refs?: string[]
  /** Walk remote-tracking branches in "All" mode. Defaults to `true`. */
  showRemotes?: boolean
  /** Walk tags in "All" mode. Defaults to `true`. */
  showTags?: boolean
  /** Follow only first parents. Defaults to `false`. */
  firstParent?: boolean
  /** Commit ordering. Defaults to `"date"`; `"topo"` uses `--topo-order`. */
  order?: "date" | "topo"
}

export interface LogResult {
  commits: GitCommit[]
  hasMore: boolean
}

interface EffectiveRefs {
  /** refname -> peeled commit oid, or null when the ref points at no commit. */
  refs: Map<string, string | null>
}

function parseDecoration(decoration: string): string[] {
  if (!decoration) return []
  return decoration
    .split(", ")
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0)
    .map((ref) => (ref.startsWith("tag: ") ? ref.slice("tag: ".length) : ref))
}

function assertBooleanOption(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== "boolean") {
    throw new GitInputError(`Invalid log ${name} ${JSON.stringify(value)}: expected a boolean`)
  }
  return value
}

function assertLogOrder(order: unknown): "date" | "topo" {
  if (order === undefined) return "date"
  if (order !== "date" && order !== "topo") {
    throw new GitInputError(
      `Invalid log order ${JSON.stringify(order)}: expected "date" or "topo"`,
    )
  }
  return order
}

/**
 * Structural validation of an explicitly selected ref.
 *
 * The authoritative check is the `for-each-ref` allowlist (see
 * {@link readEffectiveRefs}); this only rejects shapes that can never be a
 * full refname so the error is explicit and no attacker-controlled string is
 * ever passed to git as a revision.
 */
function assertSelectableRef(ref: unknown): string {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new GitInputError("Invalid log ref: expected a non-empty fully-qualified refname")
  }
  if (ref.length > 4096) {
    throw new GitInputError("Invalid log ref: refname is too long")
  }
  if (ref.includes("\0")) {
    throw new GitInputError(`Invalid log ref ${JSON.stringify(ref)}: NUL bytes are not allowed`)
  }
  if (ref.startsWith("-")) {
    throw new GitInputError(
      `Invalid log ref ${JSON.stringify(ref)}: option-like refnames are not allowed`,
    )
  }
  if (!SELECTABLE_REF_PREFIXES.some((prefix) => ref.startsWith(prefix))) {
    throw new GitInputError(
      `Invalid log ref ${JSON.stringify(ref)}: expected refs/heads/*, refs/remotes/* or refs/tags/*`,
    )
  }
  if (INVALID_REF_CHARS.test(ref)) {
    throw new GitInputError(
      `Invalid log ref ${JSON.stringify(ref)}: contains characters git forbids in a refname`,
    )
  }
  if (
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("//") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock")
  ) {
    throw new GitInputError(`Invalid log ref ${JSON.stringify(ref)}: not a valid refname`)
  }
  const prefix = SELECTABLE_REF_PREFIXES.find((candidate) => ref.startsWith(candidate))
  if (!prefix || ref.length === prefix.length) {
    throw new GitInputError(`Invalid log ref ${JSON.stringify(ref)}: missing ref name`)
  }
  return ref
}

/** Validate the `refs` option and remove duplicates while preserving order. */
function assertLogRefs(refs: unknown): string[] {
  if (refs === undefined) return []
  if (!Array.isArray(refs)) {
    throw new GitInputError("Invalid log refs: expected an array of fully-qualified refnames")
  }
  if (refs.length > MAX_LOG_REFS) {
    throw new GitInputError(
      `Invalid log refs: at most ${MAX_LOG_REFS} refs may be selected (got ${refs.length})`,
    )
  }

  const seen = new Set<string>()
  const selected: string[] = []
  for (const ref of refs) {
    const name = assertSelectableRef(ref)
    if (seen.has(name)) continue
    seen.add(name)
    selected.push(name)
  }
  return selected
}

/**
 * Read every effective ref together with the commit it resolves to.
 *
 * Annotated tags point at a tag object, so the peeled `*objectname` is used
 * when `*objecttype` is `commit`. Refs that do not resolve to a commit (e.g. a
 * tag pointing at a blob) are kept with a null value so an explicit selection
 * can be reported as "not a commit" instead of "unknown".
 */
async function readEffectiveRefs(
  repoPath: string,
  options: GitSignalOptions,
): Promise<EffectiveRefs> {
  const output = await git(repoPath, ["for-each-ref", `--format=${REF_FORMAT}`], options)
  const refs = new Map<string, string | null>()

  for (const line of output.split("\n")) {
    if (!line) continue
    const [refname, objectName, objectType, peeledName = "", peeledType = ""] = line.split("\0")
    if (!refname || !objectName) continue
    if (!SELECTABLE_REF_PREFIXES.some((prefix) => refname.startsWith(prefix))) continue

    const commit =
      objectType === "commit"
        ? objectName
        : peeledType === "commit" && peeledName
          ? peeledName
          : null
    refs.set(refname, commit)
  }

  return { refs }
}

/** Resolve explicitly selected refnames to commit oids using the allowlist. */
async function resolveSelectedRefs(
  repoPath: string,
  refs: string[],
  options: GitSignalOptions,
): Promise<string[]> {
  const effective = await readEffectiveRefs(repoPath, options)
  const oids: string[] = []
  const seen = new Set<string>()

  for (const ref of refs) {
    if (!effective.refs.has(ref)) {
      throw new GitInputError(
        `Unknown log ref ${JSON.stringify(ref)}: not present in this repository`,
      )
    }
    const oid = effective.refs.get(ref)
    if (!oid) {
      throw new GitInputError(
        `Invalid log ref ${JSON.stringify(ref)}: does not resolve to a commit`,
      )
    }
    if (seen.has(oid)) continue
    seen.add(oid)
    oids.push(oid)
  }

  return oids
}

/**
 * Revision arguments for "All" mode.
 *
 * Defaults (`showRemotes` and `showTags` both true) keep the historical
 * `--all` walk, which includes `HEAD` (so a detached HEAD is still shown).
 * Disabling either remote branches or tags narrows the walk while `HEAD` stays
 * explicit, so detached repositories behave the same way. `HEAD` is added only
 * when it resolves: adding an unborn HEAD to `--branches` would make git abort
 * even when other branches still have commits.
 */
async function allRefArgs(
  repoPath: string,
  showRemotes: boolean,
  showTags: boolean,
  options: GitSignalOptions,
): Promise<string[]> {
  if (showRemotes && showTags) return ["--all"]
  const args = [
    "--branches",
    ...(showRemotes ? ["--remotes"] : []),
    ...(showTags ? ["--tags"] : []),
  ]
  if (await hasHeadCommit(repoPath, options)) args.push("HEAD")
  return args
}

async function hasHeadCommit(repoPath: string, options: GitSignalOptions): Promise<boolean> {
  try {
    const output = await git(
      repoPath,
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      options,
    )
    return output.trim().length > 0
  } catch {
    // Unborn HEAD (empty repository or an orphan branch).
    return false
  }
}

/** Errors git emits when `log` is asked for revisions in an unborn repository. */
const EMPTY_REPOSITORY_ERROR =
  /(does not have any commits yet|bad revision|unknown revision|ambiguous argument|not a valid object name)/i

/**
 * Read commits newest first, ordered by commit date by default.
 *
 * `--date-order` still guarantees that every parent is emitted after all of its
 * children, but it interleaves independent lines by commit timestamp instead of
 * grouping each branch. `--topo-order` (`order: "topo"`) groups each branch.
 *
 * The format is field-delimited by NUL and records are newline separated. `%s`
 * (subject) is a single line, so it is safe to split records on `\n`.
 *
 * `limit` must be an integer in 1..1000 and `skip` an integer in 0..10000000;
 * anything else is rejected instead of being silently coerced.
 *
 * `refs` selects explicit, fully-qualified refs (validated against git's
 * effective refs) and takes priority over the show flags. An empty/omitted
 * `refs` walks All refs according to `showRemotes`/`showTags`.
 *
 * Selected revisions are placed after every option and immediately before the
 * `--` pathspec separator; they are passed as resolved commit oids, never as
 * caller-provided strings.
 */
export async function getLog(
  repoPath: string,
  {
    limit = 200,
    skip = 0,
    signal,
    refs,
    showRemotes,
    showTags,
    firstParent,
    order,
  }: LogOptions = {},
): Promise<LogResult> {
  const safeLimit = assertLogLimit(limit)
  const safeSkip = assertLogSkip(skip)
  const safeRefs = assertLogRefs(refs)
  const safeShowRemotes = assertBooleanOption(showRemotes, "showRemotes", true)
  const safeShowTags = assertBooleanOption(showTags, "showTags", true)
  const safeFirstParent = assertBooleanOption(firstParent, "firstParent", false)
  const safeOrder = assertLogOrder(order)

  const explicitRefs = safeRefs.length > 0
  const revisionArgs = explicitRefs
    ? await resolveSelectedRefs(repoPath, safeRefs, { signal })
    : await allRefArgs(repoPath, safeShowRemotes, safeShowTags, { signal })

  const args = [
    "-c",
    "log.showSignature=false",
    "log",
    "--no-color",
    ...revisionArgs,
    safeOrder === "topo" ? "--topo-order" : "--date-order",
    ...(safeFirstParent ? ["--first-parent"] : []),
    "--parents",
    `--format=${LOG_FORMAT}`,
    "--skip",
    String(safeSkip),
    "-n",
    String(safeLimit + 1),
    "--",
  ]

  const output = await git(repoPath, args, { signal }).catch((error: unknown) => {
    // An unborn repository has no revisions to walk, regardless of which ref
    // subset was requested. Explicit refs were already validated, so this only
    // applies to the All-mode flags.
    if (
      !explicitRefs &&
      error instanceof GitError &&
      EMPTY_REPOSITORY_ERROR.test(error.stderr)
    ) {
      return ""
    }
    throw error
  })

  const commits: GitCommit[] = []
  for (const line of output.split("\n")) {
    if (!line) continue
    const fields = line.split("\0")
    if (fields.length < 6) continue
    const [hash, parentsRaw, author, authorDate, subject, decoration] = fields
    commits.push({
      hash,
      parents: parentsRaw.split(/\s+/).filter((parent) => parent.length > 0),
      author,
      authorDate,
      subject,
      refs: parseDecoration(decoration),
    })
  }

  return {
    commits: commits.slice(0, safeLimit),
    hasMore: commits.length > safeLimit,
  }
}
