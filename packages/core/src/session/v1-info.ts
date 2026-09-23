import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionV1 } from "../v1/session"
import type { SessionTable } from "./sql"

// The session row as a full v1 SessionInfo. `session.updated` rewrites every column from
// its payload, so anything that republishes a session (rename) must start from an exact
// copy of the row or it silently drops fields. Mirrors fromRow in
// packages/opencode/src/session/session.ts; keep the two in step.
export function toSessionInfo(row: typeof SessionTable.$inferSelect): SessionV1.SessionInfo {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  return SessionV1.SessionInfo.make({
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ModelV2.ID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: row.model.variant,
        }
      : undefined,
    version: row.version,
    summary,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: { read: row.tokens_cache_read, write: row.tokens_cache_write },
    },
    share: row.share_url ? { url: row.share_url } : undefined,
    metadata: row.metadata ?? undefined,
    revert: row.revert
      ? {
          messageID: SessionV1.MessageID.make(row.revert.messageID),
          partID: row.revert.partID ? SessionV1.PartID.make(row.revert.partID) : undefined,
          snapshot: row.revert.snapshot,
          diff: row.revert.diff,
        }
      : undefined,
    permission: row.permission ? [...row.permission] : undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  })
}
