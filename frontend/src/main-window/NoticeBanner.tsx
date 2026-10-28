import { useState } from "react";
import { Dialog } from "../lib/dialog";
import { Icon } from "../lib/icon";
import { useApp } from "../state/context";
import type { NoticePart } from "../state/store";
import { StarBanner } from "./StarBanner";
import { UpdateBanner } from "./UpdateBanner";

function withOffsets(parts: NoticePart[]) {
  let at = 0;
  return parts.map((part) => {
    const start = at;
    at += part.text.length;
    return { part, at: start };
  });
}

export function NoticeBanner() {
  const notice = useApp((state) => state.notice);
  const pull = useApp((state) => state.pull);
  const push = useApp((state) => state.push);
  const showDialog = useApp((state) => state.showDialog);
  const select = useApp((state) => state.select);
  const setTab = useApp((state) => state.setTab);
  const dismissNotice = useApp((state) => state.dismissNotice);
  const [details, setDetails] = useState(false);
  if (!notice)
    return (
      <>
        <UpdateBanner />
        <StarBanner />
      </>
    );
  const success = notice.kind === "success";
  return (
    <div className="app-editor-notice">
      <div className={`dl-banner ${success ? "is-success" : "is-error"}`} role="status">
        <Icon name={success ? "status-success" : "status-error"} />
        <span className="dl-banner-text">
          {withOffsets(notice.parts).map(({ part, at }) =>
            part.strong ? <b key={at}>{part.text}</b> : <span key={at}>{part.text}</span>,
          )}
        </span>
        <span className="dl-banner-actions">
          {notice.actions.includes("pull") && (
            <button className="app-link" type="button" onClick={() => void pull()}>
              Fetch and merge
            </button>
          )}
          {notice.actions.includes("push") && (
            <button className="app-link" type="button" onClick={() => void push()}>
              Push…
            </button>
          )}
          {notice.actions.includes("commit") && (
            <button className="app-link" type="button" onClick={() => showDialog("commit")}>
              Commit…
            </button>
          )}
          {notice.actions.includes("showFiles") && notice.files?.[0] && (
            <button
              className="app-link"
              type="button"
              onClick={() => {
                setTab("changes");
                select(notice.files?.[0] ?? null);
              }}
            >
              Show files
            </button>
          )}
          {notice.actions.includes("details") && notice.details && (
            <button className="app-link" type="button" onClick={() => setDetails(true)}>
              Show details
            </button>
          )}
          {notice.actions.includes("log") && (
            <button
              className="app-link"
              type="button"
              onClick={() => {
                setTab("log");
                dismissNotice();
              }}
            >
              Show in Commit history
            </button>
          )}
          <button
            className="dl-tbtn app-notice-close"
            type="button"
            aria-label="Close"
            title="Close"
            onClick={dismissNotice}
          >
            <Icon name="general-close" />
          </button>
        </span>
      </div>
      {details && (
        <Dialog label="Git output" onClose={() => setDetails(false)}>
          <div className="dl-dialog-title">Git output</div>
          <pre className="app-git-output">{notice.details}</pre>
          <div className="dl-dialog-footer">
            <button
              className="dl-btn dl-btn-primary"
              type="button"
              onClick={() => setDetails(false)}
            >
              Close
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
