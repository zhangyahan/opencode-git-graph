import type { GitRef } from "../../shared/types.js"
import { git, type GitSignalOptions } from "./executor.js"

const HEADS_PREFIX = "refs/heads/"
const REMOTES_PREFIX = "refs/remotes/"
const TAGS_PREFIX = "refs/tags/"

const REF_FORMAT =
  "%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)"

/**
 * Resolve the commit an object id should be graphed as.
 *
 * Annotated tags point at a tag object; use the peeled commit instead so every
 * returned ref has a hash that exists in the graph. Non-commit refs are skipped.
 */
function commitOid(
  objectName: string,
  objectType: string,
  peeledName: string,
  peeledType: string,
): string | null {
  if (objectType === "commit") return objectName
  if (peeledType === "commit") return peeledName
  return null
}

/** List branches, remotes and tags, plus a synthetic `head` entry. */
export async function getRefs(
  repoPath: string,
  options: GitSignalOptions = {},
): Promise<GitRef[]> {
  const output = await git(repoPath, ["for-each-ref", `--format=${REF_FORMAT}`], options)

  const refs: GitRef[] = []
  for (const line of output.split("\n")) {
    if (!line) continue
    const [refname, objectName, objectType, peeledName = "", peeledType = ""] = line.split("\0")
    if (!refname || !objectName) continue

    const hash = commitOid(objectName, objectType ?? "", peeledName, peeledType)
    if (!hash) continue

    if (refname.startsWith(HEADS_PREFIX)) {
      refs.push({ name: refname.slice(HEADS_PREFIX.length), hash, kind: "branch" })
    } else if (refname.startsWith(REMOTES_PREFIX)) {
      refs.push({ name: refname.slice(REMOTES_PREFIX.length), hash, kind: "remote" })
    } else if (refname.startsWith(TAGS_PREFIX)) {
      refs.push({ name: refname.slice(TAGS_PREFIX.length), hash, kind: "tag" })
    }
  }

  let head: string | null = null
  try {
    head = (await git(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD"], options)).trim() || null
  } catch {
    // Unborn HEAD (empty repository): no head entry.
    head = null
  }

  if (head) {
    let name = "HEAD"
    try {
      const branch = (
        await git(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"], options)
      ).trim()
      if (branch) name = branch
    } catch {
      // Detached HEAD: expose it under the synthetic "HEAD" name.
    }
    refs.push({ name, hash: head, kind: "head" })
  }

  return refs
}
