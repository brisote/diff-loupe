import { useMemo, useState } from "react";
import { type ApiError, type FileChange, toApiError } from "../api";
import { fileIcon } from "../changes/fileIcons";
import { isTracked, statusClass } from "../changes/rows";
import { Dialog } from "../lib/dialog";
import { Checkbox } from "../lib/fields";
import { Icon } from "../lib/icon";
import { splitPath } from "../lib/paths";
import { useApp } from "../state/context";
import { groupCount } from "./CommitDialog";

export function rollbackFiles(changes: FileChange[]): FileChange[] {
  return changes.filter(isTracked).sort((a, b) => a.path.localeCompare(b.path));
}

export function rollbackPicks(files: FileChange[], selection: string | null): Set<string> {
  const selected = files.find((file) => file.path === selection);
  return new Set(selected ? [selected.path] : files.map((file) => file.path));
}

export function isAdded(change: FileChange): boolean {
  return (
    change.staged &&
    (change.kind === "added" || change.kind === "renamed" || change.kind === "copied")
  );
}

export function rollbackPaths(files: FileChange[], checked: ReadonlySet<string>): string[] {
  return files
    .filter((file) => checked.has(file.path))
    .flatMap((file) =>
      file.kind === "renamed" && file.headPath ? [file.headPath, file.path] : [file.path],
    );
}

export function RollbackDialog() {
  const repo = useApp((state) => state.repo);
  const changes = useApp((state) => state.uncommitted);
  const rollbackChanges = useApp((state) => state.rollbackChanges);
  const showDialog = useApp((state) => state.showDialog);
  const files = useMemo(() => rollbackFiles(changes ?? []), [changes]);
  const selection = repo?.lastSelection ?? null;
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const checked = useMemo(
    () => picked ?? rollbackPicks(files, selection),
    [picked, files, selection],
  );
  const [deleteAdded, setDeleteAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  if (!repo) return null;

  const close = () => showDialog(null);
  const toggle = (paths: string[], on: boolean) => {
    const next = new Set(checked);
    for (const path of paths) {
      if (on) next.add(path);
      else next.delete(path);
    }
    setPicked(next);
  };
  const paths = rollbackPaths(files, checked);
  const added = files.some((file) => checked.has(file.path) && isAdded(file));
  const count = files.filter((file) => checked.has(file.path)).length;
  const ready = paths.length > 0 && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await rollbackChanges({ files: paths, deleteAdded: added && deleteAdded });
    } catch (failure) {
      setError(toApiError(failure));
      setBusy(false);
    }
  };

  return (
    <Dialog label="Rollback Changes" className="app-commit" onClose={close}>
      <div className="dl-dialog-title">Rollback Changes</div>
      <p className="dl-dialog-text">
        The checked files go back to their last commit on <b>{repo.branch ?? "HEAD"}</b>. Their
        changes are lost.
      </p>
      <div className="app-commit-body">
        <section className="dl-list app-commit-files" aria-label="Files to roll back">
          <div className="dl-row dl-row-group">
            <Checkbox
              label="Changes"
              hideLabel
              checked={files.length > 0 && count === files.length}
              mixed={count > 0 && count < files.length}
              onChange={() =>
                toggle(
                  files.map((file) => file.path),
                  count < files.length,
                )
              }
            />
            <span>Changes</span>
            <span className="dl-row-count">{groupCount(files.length, count)}</span>
          </div>
          {files.map((file) => {
            const { name, folder } = splitPath(file.path);
            return (
              <div
                key={file.path}
                className="dl-row"
                style={{ "--depth": 1 } as React.CSSProperties}
                title={file.headPath ? `Renamed from ${file.headPath}` : undefined}
              >
                <Checkbox
                  label={file.path}
                  hideLabel
                  checked={checked.has(file.path)}
                  onChange={(on) => toggle([file.path], on)}
                />
                <span className={`dl-i ${fileIcon(file.path)}`} aria-hidden="true" />
                <span className={`dl-row-name ${statusClass(file.kind)}`}>{name}</span>
                <span className="dl-row-path">{folder}</span>
              </div>
            );
          })}
        </section>
        {added && (
          <Checkbox
            label="Delete local copies of added files"
            checked={deleteAdded}
            onChange={setDeleteAdded}
          />
        )}
        {error && (
          <div className="dl-banner is-error" role="alert">
            <Icon name="status-error" />
            <span className="dl-banner-text app-commit-error">{error.message}</span>
          </div>
        )}
      </div>
      <div className="dl-dialog-footer">
        <button className="dl-btn" type="button" onClick={close}>
          Cancel
        </button>
        <button
          className="dl-btn dl-btn-primary"
          type="button"
          disabled={!ready}
          onClick={() => void submit()}
        >
          Rollback
        </button>
      </div>
    </Dialog>
  );
}
