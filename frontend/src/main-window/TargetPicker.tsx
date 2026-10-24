import { type RefObject, useEffect } from "react";
import { Popup, useBelow } from "../lib/popup";
import { useApp } from "../state/context";
import { BranchList, type BranchSection } from "./BranchList";

type Props = { anchor: RefObject<HTMLElement | null>; onClose: () => void };

export function targetSections(
  defaultBranch: string | null,
  current: string | null,
  local: string[],
  remote: string[],
): BranchSection[] {
  const skip = (name: string) => name === defaultBranch || name === current;
  const twins = defaultBranch
    ? remote
        .filter((name) => name.slice(name.indexOf("/") + 1) === defaultBranch)
        .sort((a, b) => Number(!a.startsWith("origin/")) - Number(!b.startsWith("origin/")))
    : [];
  return [
    {
      title: "Default",
      names: defaultBranch ? [defaultBranch, ...twins].filter((name) => name !== current) : [],
    },
    { title: "Local", names: local.filter((name) => !skip(name)) },
    { title: "Remote", names: remote.filter((name) => !twins.includes(name)) },
  ];
}

export function TargetPicker({ anchor, onClose }: Props) {
  const repo = useApp((state) => state.repo);
  const branches = useApp((state) => state.branches);
  const loadBranches = useApp((state) => state.loadBranches);
  const setTarget = useApp((state) => state.setTarget);
  const style = useBelow(anchor);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  if (!repo) return null;
  const sections = branches
    ? targetSections(repo.defaultBranch, branches.current, branches.local, branches.remote)
    : [];
  return (
    <Popup
      label="Target branch"
      role="dialog"
      className="app-target-picker"
      anchor={anchor}
      style={style}
      onClose={onClose}
    >
      <BranchList
        id="target-search"
        label="Target branches"
        sections={sections}
        selected={repo.target}
        tags={repo.defaultBranch ? { [repo.defaultBranch]: "default" } : {}}
        onChoose={(name) => {
          onClose();
          void setTarget(name);
        }}
      />
    </Popup>
  );
}
