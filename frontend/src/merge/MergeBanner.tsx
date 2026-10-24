import type { MergeState } from "../api";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";

const busy: Record<string, string> = {
  rebase: "A rebase is in progress. Finish or abort it in the terminal.",
  cherryPick: "A cherry-pick is in progress. Finish or abort it in the terminal.",
  revert: "A revert is in progress. Finish or abort it in the terminal.",
};

export function mergeTitle(merge: MergeState, branch: string | null) {
  return (
    <>
      Merging <b>{merge.theirs ?? "a branch"}</b> into <b>{branch ?? "HEAD"}</b>
    </>
  );
}

export function MergeBanner() {
  const merge = useApp((state) => state.merge);
  const branch = useApp((state) => state.repo?.branch ?? null);
  const showDialog = useApp((state) => state.showDialog);
  const focusTerminal = useApp((state) => state.focusTerminal);
  if (!merge?.operation) return null;
  if (merge.operation !== "merge")
    return (
      <div className="app-editor-notice">
        <div className="dl-banner is-warning" role="status">
          <Icon name="status-warning" />
          <span className="dl-banner-text">{busy[merge.operation]}</span>
          <span className="dl-banner-actions">
            <button className="app-link" type="button" onClick={focusTerminal}>
              Open Terminal
            </button>
          </span>
        </div>
      </div>
    );
  const count = merge.conflicts.length;
  if (count === 0)
    return (
      <div className="app-editor-notice">
        <div className="dl-banner is-success" role="status">
          <Icon name="status-success" />
          <span className="dl-banner-text">
            All conflicts are resolved. Commit the merge to finish it.
          </span>
          <span className="dl-banner-actions">
            <button className="app-link" type="button" onClick={() => showDialog("commit")}>
              Commit merge
            </button>
          </span>
        </div>
      </div>
    );
  return (
    <div className="app-editor-notice">
      <div className="dl-banner is-warning" role="status">
        <Icon name="status-warning" />
        <span className="dl-banner-text">
          {mergeTitle(merge, branch)}: {count === 1 ? "1 file has" : `${count} files have`}{" "}
          conflicts.
        </span>
        <span className="dl-banner-actions">
          <button className="app-link" type="button" onClick={() => showDialog("conflicts")}>
            Resolve
          </button>
          <button className="app-link" type="button" onClick={() => showDialog("abortMerge")}>
            Abort merge
          </button>
        </span>
      </div>
    </div>
  );
}
