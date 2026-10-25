import { type RefObject, useEffect } from "react";
import { Icon } from "../lib/icon";
import { MenuRow } from "../lib/list";
import { Popup, useBelow } from "../lib/popup";
import { useApp } from "../state/context";
import { BranchList, type BranchSection } from "./BranchList";

type Props = { anchor: RefObject<HTMLElement | null>; onClose: () => void };

export function branchSections(
  recent: string[],
  local: string[],
  remote: string[],
): BranchSection[] {
  return [
    { title: "Recent", names: recent },
    { title: "Local", names: local.filter((name) => !recent.includes(name)) },
    { title: "Remote", names: remote },
  ];
}

export function BranchPicker({ anchor, onClose }: Props) {
  const repo = useApp((state) => state.repo);
  const branches = useApp((state) => state.branches);
  const loadBranches = useApp((state) => state.loadBranches);
  const switchBranch = useApp((state) => state.switchBranch);
  const fetchRemote = useApp((state) => state.fetchRemote);
  const push = useApp((state) => state.push);
  const showDialog = useApp((state) => state.showDialog);
  const mergeTarget = useApp((state) => state.mergeTarget);
  const merging = useApp((state) => Boolean(state.merge?.operation));
  const style = useBelow(anchor);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  if (!repo) return null;
  const run = (action: () => void) => {
    onClose();
    action();
  };
  const current = branches?.current ?? repo.branch;
  return (
    <Popup
      label="Branches"
      role="dialog"
      className="app-branch-picker"
      anchor={anchor}
      style={style}
      onClose={onClose}
    >
      <div role="menu" aria-label="Git actions">
        {repo.target && current && repo.target !== current && !merging ? (
          <MenuRow
            label={`Merge ${repo.target} into ${current}`}
            onActivate={() => run(() => void mergeTarget())}
          >
            <Icon name="vcs-merge" />
            <span className="dl-row-name app-row-wide">
              Merge {repo.target} into {current}
            </span>
          </MenuRow>
        ) : (
          <div
            className="dl-row app-row-disabled"
            role="menuitem"
            aria-disabled="true"
            tabIndex={-1}
            title={
              merging
                ? "Finish the merge in progress first"
                : !current
                  ? "Switch to a branch first"
                  : repo.target === current
                    ? "The target is the current branch. Pick another target."
                    : "Pick a target branch first"
            }
          >
            <Icon name="vcs-merge" />
            <span className="dl-row-name app-row-wide">
              Merge {repo.target ?? "the target branch"} into {current ?? "HEAD"}
            </span>
          </div>
        )}
        <MenuRow label="Fetch" onActivate={() => run(() => void fetchRemote())}>
          <Icon name="vcs-fetch" />
          <span className="dl-row-name">Fetch</span>
        </MenuRow>
        <MenuRow label="Commit…" onActivate={() => run(() => showDialog("commit"))}>
          <Icon name="vcs-commit" />
          <span className="dl-row-name">Commit…</span>
          <span className="dl-row-path" />
          <span className="dl-row-key">⌘K</span>
        </MenuRow>
        <MenuRow label="Push…" onActivate={() => run(() => void push())}>
          <Icon name="vcs-push" />
          <span className="dl-row-name">Push…</span>
          <span className="dl-row-path" />
          <span className="dl-row-key">⇧⌘K</span>
        </MenuRow>
      </div>
      <div className="dl-popup-sep" />
      <BranchList
        id="branch-search"
        label="Branches"
        sections={branches ? branchSections(branches.recent, branches.local, branches.remote) : []}
        selected={current}
        tags={current ? { [current]: "current" } : {}}
        onChoose={(name) => run(() => void switchBranch(name))}
      />
    </Popup>
  );
}
