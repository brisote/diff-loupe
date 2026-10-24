import { useEffect, useState } from "react";
import { Dialog } from "../lib/dialog";
import { useApp } from "../state/context";
import { issueForm, reportText } from "../state/reports";

export function ErrorReportDialog() {
  const report = useApp((state) => state.errorReport);
  const openLink = useApp((state) => state.openLink);
  const close = useApp((state) => state.closeErrorReport);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (report) setCopied(false);
  }, [report]);
  if (!report) return null;
  const text = reportText(report.env, report.context, report.failures, report.calls);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog label="Diffloupe ran into a problem" className="app-error-report" onClose={close}>
      <div className="dl-dialog-title">Diffloupe ran into a problem</div>
      <p className="dl-dialog-text">
        Please report it on GitHub so it can be fixed. Copy the report and paste it into the new
        issue as it is. Your home and repository folders are hidden.
      </p>
      <div className="app-error-report-body">
        <textarea
          className="dl-textarea app-error-report-text"
          readOnly
          aria-label="Error report"
          value={text}
        />
      </div>
      <div className="dl-dialog-footer">
        <button className="dl-btn" type="button" onClick={close}>
          Close
        </button>
        <button className="dl-btn" type="button" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy report"}
        </button>
        <button className="dl-btn dl-btn-primary" type="button" onClick={() => openLink(issueForm)}>
          Open GitHub issue
        </button>
      </div>
    </Dialog>
  );
}
