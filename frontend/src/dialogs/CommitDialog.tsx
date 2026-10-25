import { useEffect, useMemo, useRef, useState } from "react";
import { type ApiError, type FileChange, toApiError } from "../api";
import { fileIcon } from "../changes/fileIcons";
import {
  fileCount,
  type GroupId,
  inChanges,
  inStaged,
  isTracked,
  rowKey,
  statusClass,
} from "../changes/rows";
import { Dialog } from "../lib/dialog";
import { Checkbox } from "../lib/fields";
import { Icon } from "../lib/icon";
import { MenuRow } from "../lib/list";
import { splitPath } from "../lib/paths";
import { hasModifier, usePlatform } from "../lib/platform";
import { Popup } from "../lib/popup";
import { useApp } from "../state/context";

type Group = { id: GroupId; label: string; files: FileChange[] };

export function commitGroups(changes: FileChange[]): Group[] {
  const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path);
  const groups: Group[] = [
    { id: "staged", label: "Staged", files: changes.filter(inStaged).sort(byPath) },
    { id: "changes", label: "Changes", files: changes.filter(inChanges).sort(byPath) },
    {
      id: "unversioned",
      label: "Unversioned Files",
      files: changes.filter((c) => c.kind === "untracked").sort(byPath),
    },
  ];
  return groups.filter((group) => group.files.length > 0);
}

export function defaultPicks(changes: FileChange[]): Set<string> {
  const staged = changes.filter(inStaged);
  return new Set(
    staged.length > 0
      ? staged.map((change) => rowKey("staged", change.path))
      : changes.filter(isTracked).map((change) => change.path),
  );
}

export function commitPaths(
  changes: FileChange[],
  checked: ReadonlySet<string>,
): { files: string[]; staged: string[] } {
  const paths = (change: FileChange) =>
    change.headPath ? [change.headPath, change.path] : [change.path];
  return {
    files: changes.filter((change) => checked.has(change.path)).flatMap(paths),
    staged: changes.filter((change) => checked.has(rowKey("staged", change.path))).flatMap(paths),
  };
}

function MergedFiles({ files }: { files: FileChange[] }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="dl-list app-commit-files" aria-label="Merged files">
      <button
        className="dl-row dl-row-group app-row-button"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? "general-chevronDown" : "general-chevronRight"} />
        <span>Merged files</span>
        <span className="dl-row-count">{fileCount(files.length)}</span>
      </button>
      {open &&
        files.map((file) => {
          const { name, folder } = splitPath(file.path);
          return (
            <div key={file.path} className="dl-row" style={{ "--depth": 1 } as React.CSSProperties}>
              <span className={`dl-i ${fileIcon(file.path)}`} aria-hidden="true" />
              <span className={`dl-row-name ${statusClass(file.kind)}`}>{name}</span>
              <span className="dl-row-path">{folder}</span>
            </div>
          );
        })}
    </section>
  );
}

export function groupCount(total: number, checked: number): string {
  return checked > 0 && checked < total ? `${checked} of ${total} files` : fileCount(total);
}

export function CommitDialog() {
  const platform = usePlatform();
  const repo = useApp((state) => state.repo);
  const changes = useApp((state) => state.uncommitted);
  const backend = useApp((state) => state.backend);
  const commitChanges = useApp((state) => state.commitChanges);
  const showDialog = useApp((state) => state.showDialog);
  const merge = useApp((state) => state.merge);
  const merging = merge?.operation === "merge" && merge.conflicts.length === 0;
  const groups = useMemo(() => commitGroups(changes ?? []), [changes]);
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const checked = useMemo(() => picked ?? defaultPicks(changes ?? []), [picked, changes]);
  const [message, setMessage] = useState("");
  const mergeMessage = merging ? (merge?.message ?? "") : "";
  useEffect(() => {
    if (mergeMessage) setMessage((current) => current || mergeMessage);
  }, [mergeMessage]);
  const [amend, setAmend] = useState(false);
  const [history, setHistory] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => box.current?.focus(), []);
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
  const merged = (changes ?? [])
    .filter((change) => isTracked(change) && change.staged)
    .sort((a, b) => a.path.localeCompare(b.path));
  const { files, staged } = merging
    ? { files: [], staged: [] }
    : commitPaths(changes ?? [], checked);
  const ready =
    message.trim().length > 0 &&
    (files.length > 0 || staged.length > 0 || amend || merging) &&
    !busy;

  const submit = async (push: boolean) => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await commitChanges({ message, amend, files, staged, push });
    } catch (failure) {
      setError(toApiError(failure));
      setBusy(false);
    }
  };
  const onAmend = async (on: boolean) => {
    setAmend(on);
    if (!on || message.trim()) return;
    const last = await backend.call("head_message", { path: repo.path }).catch(() => null);
    if (last) setMessage((current) => (current.trim() ? current : last));
  };
  const openHistory = async () => {
    if (history) {
      setHistory(null);
      return;
    }
    const messages = await backend
      .call("commit_messages", { path: repo.path })
      .catch(() => [] as string[]);
    setHistory(messages);
  };

  return (
    <Dialog
      label={merging ? "Commit Merge" : "Commit Changes"}
      className="app-commit"
      onClose={close}
    >
      <div className="dl-dialog-title">{merging ? "Commit Merge" : "Commit Changes"}</div>
      <p className="dl-dialog-text">
        {merging ? (
          <>
            Commit the merge of <b>{merge?.theirs ?? "the branch"}</b> into{" "}
            <b>{repo.branch ?? "HEAD"}</b>. All conflicts are resolved.
          </>
        ) : (
          <>
            Commit to <b>{repo.branch ?? "HEAD"}</b>.
          </>
        )}
      </p>
      <div className="app-commit-body">
        {merging ? (
          <MergedFiles files={merged} />
        ) : (
          <section className="dl-list app-commit-files" aria-label="Files to commit">
            {groups.map((group) => {
              const paths = group.files.map((file) => rowKey(group.id, file.path));
              const count = paths.filter((path) => checked.has(path)).length;
              return (
                <div key={group.id}>
                  <div className="dl-row dl-row-group">
                    <Checkbox
                      label={group.label}
                      hideLabel
                      checked={count === paths.length}
                      mixed={count > 0 && count < paths.length}
                      onChange={() => toggle(paths, count < paths.length)}
                    />
                    <span>{group.label}</span>
                    <span className="dl-row-count">{groupCount(paths.length, count)}</span>
                  </div>
                  {group.files.map((file) => {
                    const { name, folder } = splitPath(file.path);
                    const key = rowKey(group.id, file.path);
                    return (
                      <div
                        key={key}
                        className="dl-row"
                        style={{ "--depth": 1 } as React.CSSProperties}
                        title={file.headPath ? `Renamed from ${file.headPath}` : undefined}
                      >
                        <Checkbox
                          label={group.id === "staged" ? `${file.path}, staged` : file.path}
                          hideLabel
                          checked={checked.has(key)}
                          onChange={(on) => toggle([key], on)}
                        />
                        <span className={`dl-i ${fileIcon(file.path)}`} aria-hidden="true" />
                        <span className={`dl-row-name ${statusClass(file.kind)}`}>{name}</span>
                        <span className="dl-row-path">{folder}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {groups.length === 0 && <div className="dl-row app-row-disabled">No changed files</div>}
          </section>
        )}
        <div className="app-commit-label">
          <span>Commit message</span>
          <span className="dl-toolbar-spacer" />
          <button
            ref={historyButton}
            className="dl-tbtn"
            type="button"
            aria-label="Recent messages"
            title="Recent messages"
            aria-expanded={history !== null}
            onClick={() => void openHistory()}
          >
            <Icon name="general-history" />
          </button>
          {history && (
            <Popup
              label="Recent messages"
              role="menu"
              className="app-commit-history"
              anchor={historyButton}
              onClose={() => setHistory(null)}
            >
              {history.length === 0 && <div className="dl-popup-section">No messages yet</div>}
              {history.map((item) => (
                <MenuRow
                  key={item}
                  label={item.split("\n")[0]}
                  onActivate={() => {
                    setMessage(item);
                    setHistory(null);
                    box.current?.focus();
                  }}
                >
                  <span className="dl-row-name app-row-wide">{item.split("\n")[0]}</span>
                </MenuRow>
              ))}
            </Popup>
          )}
        </div>
        <textarea
          ref={box}
          className="dl-textarea app-commit-message"
          aria-label="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && hasModifier(platform, event)) {
              event.preventDefault();
              void submit(false);
            }
          }}
        />
        {merging ? (
          <span className="app-commit-hint">
            A merge commit includes every merged file. Amend is not available.
          </span>
        ) : (
          <Checkbox label="Amend" checked={amend} onChange={(on) => void onAmend(on)} />
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
          className="dl-btn"
          type="button"
          disabled={!ready}
          onClick={() => void submit(false)}
        >
          Commit
        </button>
        <button
          className="dl-btn dl-btn-primary"
          type="button"
          disabled={!ready}
          onClick={() => void submit(true)}
        >
          Commit and Push
        </button>
      </div>
    </Dialog>
  );
}
