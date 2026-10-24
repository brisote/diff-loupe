import { useState } from "react";
import { type ApiError, toApiError } from "../api";
import { Dialog } from "../lib/dialog";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";

export function UninstallDialog() {
  const backend = useApp((state) => state.backend);
  const showDialog = useApp((state) => state.showDialog);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const close = () => showDialog(null);

  const uninstall = async () => {
    setRunning(true);
    setError(null);
    try {
      await backend.uninstall();
    } catch (failure) {
      setError(toApiError(failure));
      setRunning(false);
    }
  };

  return (
    <Dialog label="Uninstall Diffloupe" className="app-uninstall" onClose={close}>
      <div className="dl-dialog-title">Uninstall Diffloupe</div>
      <p className="dl-dialog-text">
        This deletes Diffloupe's own files from this Mac, moves the app to the Trash and quits. Your
        repositories are not touched, and neither is data that other apps keep.
      </p>
      {error && (
        <div className="app-uninstall-error">
          <div className="dl-banner is-error" role="alert">
            <Icon name="status-error" />
            <span className="dl-banner-text app-commit-error">{error.message}</span>
          </div>
        </div>
      )}
      <div className="app-gap-12" />
      <div className="dl-dialog-footer">
        <button className="dl-btn" type="button" disabled={running} onClick={close}>
          Cancel
        </button>
        <button
          className="dl-btn dl-btn-primary"
          type="button"
          disabled={running}
          onClick={() => void uninstall()}
        >
          {running ? "Uninstalling…" : "Uninstall"}
        </button>
      </div>
    </Dialog>
  );
}
