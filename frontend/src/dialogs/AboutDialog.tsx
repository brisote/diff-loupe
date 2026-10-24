import { Dialog } from "../lib/dialog";
import { Icon } from "../lib/icon";
import { buildMonth, shortVersion } from "../lib/version";
import { useApp } from "../state/context";

export function AboutDialog() {
  const version = useApp((state) => state.info?.version ?? "");
  const showDialog = useApp((state) => state.showDialog);
  const close = () => showDialog(null);
  return (
    <Dialog label="About Diffloupe" className="app-about" onClose={close}>
      <div className="app-about-head">
        <span className="welcome-name">Diffloupe</span>
        <span className="welcome-version">
          Version {shortVersion(version)} · {buildMonth(__BUILD_DATE__)}
        </span>
      </div>
      <p className="dl-dialog-text">
        Diffloupe aims to give you the best possible experience for reviewing a diff. It is open
        source, and the only network call it makes on its own is a check for a new version on
        GitHub, which you can turn off in Settings.
      </p>
      <div className="app-about-note">
        <div className="dl-banner is-info">
          <Icon name="status-info" />
          <span className="dl-banner-text">
            To remove Diffloupe, use <b>Uninstall Diffloupe…</b> in the settings menu. Dragging the
            app to the Trash leaves its settings on this Mac.
          </span>
          <span className="dl-banner-actions" />
        </div>
      </div>
      <div className="dl-dialog-footer">
        <button
          className="dl-btn"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(`Diffloupe ${version}`)}
        >
          Copy Version
        </button>
        <span className="app-fill" />
        <button className="dl-btn dl-btn-primary" type="button" onClick={close}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
