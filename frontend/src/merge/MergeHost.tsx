import { type RefObject, useEffect, useRef, useState } from "react";
import { type ApiError, type MergeFile, toApiError } from "../api";
import { shortPath } from "../diff/geometry";
import { Dialog } from "../lib/dialog";
import { Icon } from "../lib/icon";
import { splitPath } from "../lib/paths";
import { useApp } from "../state/context";
import { MergeView } from "./MergeView";
import type { MergeSide } from "./model";

const noText: Record<Exclude<MergeFile["content"], "text">, string> = {
  binary: "is a binary file",
  link: "is a link or a submodule",
  encoding: "is not UTF-8 text",
  deleted: "was deleted on one side",
};

type Props = {
  file: string;
  embedded: boolean;
  onDone: (next: string | null) => void;
  onCancel?: () => void;
  cancelRef?: RefObject<(() => void) | null>;
};

export function MergeHost({ file, embedded, onDone, onCancel, cancelRef }: Props) {
  const backend = useApp((state) => state.backend);
  const path = useApp((state) => state.repo?.path ?? null);
  const branch = useApp((state) => state.repo?.branch ?? "HEAD");
  const theirs = useApp((state) => state.merge?.theirs ?? "the branch");
  const applyMerge = useApp((state) => state.applyMerge);
  const acceptSide = useApp((state) => state.acceptSide);
  const nextConflict = useApp((state) => state.nextConflict);
  const [loaded, setLoaded] = useState<{ file: string; data: MergeFile } | null>(null);
  const data = loaded?.file === file ? loaded.data : null;
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!path) return;
    let current = true;
    setLoaded(null);
    setError(null);
    backend
      .call("merge_file", { path, file })
      .then((merge) => {
        if (current) setLoaded({ file, data: merge });
      })
      .catch((failure) => {
        if (current) setError(toApiError(failure));
      });
    return () => {
      current = false;
    };
  }, [backend, path, file]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      onDone(nextConflict(file));
    } catch (failure) {
      setError(toApiError(failure));
    }
  };
  const accept = (side: MergeSide) => void run(() => acceptSide([file], side));
  const name = splitPath(file).name;
  const failed = error && (
    <div className="app-merge-error">
      <div className="dl-banner is-error" role="alert">
        <Icon name="status-error" />
        <span className="dl-banner-text">{error.message}</span>
      </div>
    </div>
  );
  if (!data)
    return (
      <>
        {failed}
        {!error && (
          <div className="dl-empty app-fill">
            <span className="dl-empty-title">Preparing the merge</span>
            <span>{name} shows here as soon as it is ready.</span>
          </div>
        )}
      </>
    );
  if (data.content !== "text")
    return (
      <div className="dl-empty app-fill">
        <span className="dl-empty-title">
          {name} {noText[data.content]}
        </span>
        <span>Diffloupe merges text files line by line. Accept your version or theirs.</span>
        <span className="app-side-buttons">
          <button className="dl-btn" type="button" onClick={() => accept("ours")}>
            Accept Yours
          </button>
          <button className="dl-btn" type="button" onClick={() => accept("theirs")}>
            Accept Theirs
          </button>
          {onCancel && (
            <button className="dl-btn" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </span>
      </div>
    );
  return (
    <>
      {failed}
      <MergeView
        key={file}
        file={data}
        oursLabel={branch}
        theirsLabel={theirs}
        embedded={embedded}
        onApply={(text) => void run(() => applyMerge(file, text, data.crlf))}
        onAccept={accept}
        onCancel={onCancel}
        cancelRef={cancelRef}
      />
    </>
  );
}

export function MergeDialog() {
  const file = useApp((state) => state.mergeFile);
  const openMerge = useApp((state) => state.openMerge);
  const showDialog = useApp((state) => state.showDialog);
  const cancel = useRef<(() => void) | null>(null);
  if (!file) return null;
  const back = () => showDialog("conflicts");
  return (
    <Dialog
      label="Merge Revisions"
      className="app-merge-dialog"
      onClose={() => (cancel.current ?? back)()}
    >
      <div className="dl-dialog-title">Merge Revisions for {shortPath(file)}</div>
      <MergeHost
        file={file}
        embedded={false}
        onDone={(next) => (next ? openMerge(next) : showDialog(null))}
        onCancel={back}
        cancelRef={cancel}
      />
    </Dialog>
  );
}
