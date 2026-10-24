import type { ReactNode } from "react";
import { Icon } from "../lib/icon";
import { displayPath } from "../lib/paths";
import { useApp } from "../state/context";

export function OpenErrorBanner({ closable = false }: { closable?: boolean }) {
  const openError = useApp((state) => state.openError);
  const home = useApp((state) => state.info?.home);
  const openPicked = useApp((state) => state.openPicked);
  const dismissError = useApp((state) => state.dismissError);
  if (!openError) return null;
  const path = <b>{displayPath(openError.error.path ?? openError.path, home)}</b>;
  return (
    <div className="dl-banner is-error" role="alert">
      <Icon name="status-error" />
      <span className="dl-banner-text">
        {message(openError.error.code, path, openError.error.message)}
      </span>
      <span className="dl-banner-actions">
        <button className="app-link" type="button" onClick={() => void openPicked()}>
          Choose another folder
        </button>
        {closable && (
          <button className="app-link" type="button" onClick={dismissError}>
            Close
          </button>
        )}
      </span>
    </div>
  );
}

function message(code: string, path: ReactNode, fallback: string) {
  switch (code) {
    case "notARepository":
      return (
        <>
          {path} is not a git repository. Diffloupe opens folders that git tracks: the folder, or
          one above it, holds a <code className="app-code">.git</code> folder.
        </>
      );
    case "bareRepository":
      return (
        <>{path} is a bare repository. It has no working folder, so there are no changes to read.</>
      );
    case "notFound":
      return <>{path} does not exist any more. It may have been moved or deleted.</>;
    default:
      return (
        <>
          {path} could not be opened. {fallback}
        </>
      );
  }
}
