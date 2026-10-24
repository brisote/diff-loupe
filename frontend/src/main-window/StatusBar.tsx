import { Fragment } from "react";
import type { FileDiff, MergeState } from "../api";
import { isTracked } from "../changes/rows";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";

export function StatusBar() {
  const repo = useApp((state) => state.repo);
  const tasks = useApp((state) => state.tasks);
  const cancelTask = useApp((state) => state.cancelTask);
  const changes = useApp((state) => state.changes);
  const log = repo?.lastTab === "log";
  const diff = useApp((state) => (log ? state.commitDiff : state.diff));
  const logFile = useApp((state) => state.logFile);
  const merge = useApp((state) => state.merge);
  if (!repo) return null;
  const path = log
    ? logFile
    : (changes?.find((change) => change.path === repo.lastSelection)?.path ?? null);
  const crumbs = path ? [repo.name, ...path.split("/").filter(Boolean)] : [repo.name];
  const tracked = changes?.filter(isTracked).length;
  return (
    <footer className="dl-statusbar">
      <span className="dl-statusbar-item">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumbs.slice(0, index + 1).join("/")}>
            {index > 0 && <span className="dl-crumb-sep"> › </span>}
            {crumb}
          </Fragment>
        ))}
      </span>
      <span className="dl-toolbar-spacer" />
      {tasks.map((task) => (
        <span key={task.id} className="dl-statusbar-item app-task">
          <span>{task.label}</span>
          <span
            className={`dl-progress ${task.progress === null ? "is-indeterminate" : ""}`}
            role="progressbar"
            aria-label={task.label}
            aria-valuenow={task.progress === null ? undefined : Math.round(task.progress * 100)}
          >
            <i style={task.progress === null ? undefined : { width: `${task.progress * 100}%` }} />
          </span>
          {task.cancellable && (
            <button
              className="dl-tbtn app-task-cancel"
              type="button"
              aria-label={`Cancel ${task.label}`}
              title="Cancel"
              onClick={() => cancelTask(task.id)}
            >
              <Icon name="general-close" />
            </button>
          )}
        </span>
      ))}
      {repo.watchError && (
        <span
          className="dl-statusbar-item"
          title={`Diffloupe cannot watch this folder: ${repo.watchError}`}
        >
          <Icon name="status-warning" />
          Refresh by hand
        </span>
      )}
      {merge?.operation ? (
        <span className="dl-statusbar-item">{operationLabel(merge)}</span>
      ) : (
        tracked !== undefined && <span className="dl-statusbar-item">{changeCount(tracked)}</span>
      )}
      {diff && diff.path === path && diff.content === "text" && (
        <>
          <span className="dl-statusbar-item">{shownSide(diff).crlf ? "CRLF" : "LF"}</span>
          <span className="dl-statusbar-item">{shownSide(diff).encoding}</span>
        </>
      )}
      {repo.branch && (
        <span className="dl-statusbar-item">
          <Icon name="toolwindows-vcs" />
          {repo.branch}
        </span>
      )}
    </footer>
  );
}

export function operationLabel(merge: MergeState): string {
  if (merge.operation === "rebase") return "Rebasing";
  if (merge.operation === "cherryPick") return "Cherry-picking";
  if (merge.operation === "revert") return "Reverting";
  return merge.theirs ? `Merging ${merge.theirs}` : "Merging";
}

function changeCount(count: number): string {
  if (count === 0) return "No changes";
  return count === 1 ? "1 change" : `${count} changes`;
}

function shownSide(diff: FileDiff): FileDiff["right"] {
  return diff.right.exists ? diff.right : diff.left;
}
