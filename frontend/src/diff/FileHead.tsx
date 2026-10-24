import type { DiffSide, FileDiff } from "../api";
import { Icon } from "../lib/icon";
import { shortPath } from "./geometry";

const conflictMarker = /^<{7}( |$)/m;

function Revision({ side }: { side: DiffSide }) {
  if (!side.revision) return null;
  return (
    <>
      <Icon name="general-locked" />
      <span className="dl-filehead-hash">{side.revision}</span>
    </>
  );
}

export function LeftHead({ diff }: { diff: FileDiff }) {
  const side = diff.left;
  return (
    <>
      {side.title ? (
        <>
          <span className="dl-filehead-title">{side.title}</span>
          {conflictMarker.test(side.text) && <span>with conflict markers</span>}
        </>
      ) : (
        <>
          {side.revision ? <Revision side={side} /> : <Icon name="general-locked" />}
          <span>{shortPath(diff.oldPath ?? diff.path)}</span>
        </>
      )}
      {!side.exists && <span>· no file at this revision</span>}
    </>
  );
}

export function RightHead({ diff }: { diff: FileDiff }) {
  const side = diff.right;
  if (!side.revision && !side.title) {
    return (
      <span className="dl-filehead-title">
        {side.exists ? "Current version" : "Deleted in the working tree"}
      </span>
    );
  }
  return (
    <>
      <Revision side={side} />
      {side.title && <span className="dl-filehead-title">{side.title}</span>}
      {!side.exists && <span>{side.revision ? "· deleted in this commit" : "· deleted"}</span>}
    </>
  );
}
