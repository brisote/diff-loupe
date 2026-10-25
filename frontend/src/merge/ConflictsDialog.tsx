import { type MouseEvent, useState } from "react";
import { type ApiError, toApiError } from "../api";
import type { MergeSide } from "../api/generated/MergeSide";
import type { SideState } from "../api/generated/SideState";
import { fileIcon } from "../changes/fileIcons";
import { Dialog } from "../lib/dialog";
import { Icon } from "../lib/icon";
import { splitPath } from "../lib/paths";
import { hasModifier, usePlatform } from "../lib/platform";
import { useApp } from "../state/context";
import { mergeTitle } from "./MergeBanner";

const sideLabels: Record<SideState, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
};

export function nextSelection(
  paths: string[],
  selected: readonly string[],
  clicked: string,
  extend: boolean,
): string[] {
  if (!extend) return [clicked];
  const next = selected.includes(clicked)
    ? selected.filter((path) => path !== clicked)
    : [...selected, clicked];
  return paths.filter((path) => next.includes(path));
}

export function ConflictsDialog() {
  const platform = usePlatform();
  const merge = useApp((state) => state.merge);
  const branch = useApp((state) => state.repo?.branch ?? null);
  const showDialog = useApp((state) => state.showDialog);
  const acceptSide = useApp((state) => state.acceptSide);
  const openMerge = useApp((state) => state.openMerge);
  const conflicts = [...(merge?.conflicts ?? [])].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { sensitivity: "base" }),
  );
  const paths = conflicts.map((conflict) => conflict.path);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const selected = picked ? picked.filter((path) => paths.includes(path)) : paths.slice(0, 1);
  if (merge?.operation !== "merge") return null;

  const close = () => showDialog(null);
  const pick = (event: MouseEvent, path: string) =>
    setPicked(nextSelection(paths, selected, path, hasModifier(platform, event) || event.ctrlKey));
  const accept = async (side: MergeSide) => {
    setBusy(true);
    setError(null);
    try {
      await acceptSide(selected, side);
      setPicked(null);
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setBusy(false);
    }
  };
  const ready = selected.length > 0 && !busy;
  return (
    <Dialog label="Conflicts" className="app-conflicts" onClose={close}>
      <div className="dl-dialog-title">Conflicts</div>
      <p className="dl-dialog-text">
        {mergeTitle(merge, branch)} stopped on{" "}
        {conflicts.length === 1 ? "1 file" : `${conflicts.length} files`}.
      </p>
      <div className="dl-dialog-body">
        <div className="dl-table">
          <div className="dl-table-head">
            <span>Name</span>
            <span>Yours</span>
            <span>Theirs</span>
          </div>
          <div
            className="dl-list app-conflicts-list"
            role="listbox"
            aria-label="Conflicted files"
            aria-multiselectable="true"
          >
            {conflicts.map((conflict) => {
              const { name, folder } = splitPath(conflict.path);
              const isSelected = selected.includes(conflict.path);
              return (
                <div
                  key={conflict.path}
                  className={`dl-row ${isSelected ? "is-selected" : ""}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={conflict.path}
                  title={folder ? conflict.path : undefined}
                  tabIndex={0}
                  onClick={(event) => pick(event, conflict.path)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      setPicked(
                        nextSelection(paths, selected, conflict.path, hasModifier(platform, event)),
                      );
                    }
                  }}
                >
                  <span className={`dl-i ${fileIcon(conflict.path)}`} aria-hidden="true" />
                  <span className="dl-row-name st-conflict">{name}</span>
                  <span>{sideLabels[conflict.ours]}</span>
                  <span>{sideLabels[conflict.theirs]}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="dl-dialog-actions">
          <button
            className="dl-btn"
            type="button"
            disabled={!ready}
            onClick={() => void accept("ours")}
          >
            Accept Yours
          </button>
          <button
            className="dl-btn"
            type="button"
            disabled={!ready}
            onClick={() => void accept("theirs")}
          >
            Accept Theirs
          </button>
          <button
            className="dl-btn dl-btn-primary"
            type="button"
            disabled={busy || selected.length !== 1}
            title={selected.length > 1 ? "Pick one file to merge" : undefined}
            onClick={() => selected[0] && openMerge(selected[0])}
          >
            Merge…
          </button>
        </div>
      </div>
      {error && (
        <div className="app-conflicts-error">
          <div className="dl-banner is-error" role="alert">
            <Icon name="status-error" />
            <span className="dl-banner-text">{error.message}</span>
          </div>
        </div>
      )}
      <div className="dl-dialog-footer">
        <button className="dl-btn" type="button" onClick={() => showDialog("abortMerge")}>
          Abort Merge
        </button>
        <span className="dl-toolbar-spacer" />
        <button className="dl-btn" type="button" onClick={close}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function AbortMergeDialog() {
  const merge = useApp((state) => state.merge);
  const branch = useApp((state) => state.repo?.branch ?? null);
  const showDialog = useApp((state) => state.showDialog);
  const abortMerge = useApp((state) => state.abortMerge);
  const [busy, setBusy] = useState(false);
  const back = () => showDialog(null);
  return (
    <Dialog label="Abort Merge" className="app-abort" onClose={back}>
      <div className="dl-dialog-title">Abort Merge</div>
      <p className="dl-dialog-text">
        Abort the merge of <b>{merge?.theirs ?? "the branch"}</b> into <b>{branch ?? "HEAD"}</b>?
        Every file goes back to how it was before the merge, and the changes you made while
        resolving are lost.
      </p>
      <div className="dl-dialog-footer">
        <button className="dl-btn" type="button" onClick={back}>
          Cancel
        </button>
        <button
          className="dl-btn dl-btn-primary"
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void abortMerge();
          }}
        >
          Abort Merge
        </button>
      </div>
    </Dialog>
  );
}
