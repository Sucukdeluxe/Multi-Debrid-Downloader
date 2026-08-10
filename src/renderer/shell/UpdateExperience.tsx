import { useState, type ReactElement } from "react";
import type { UpdateInstallProgress } from "../../shared/types";
import { Dialog } from "../ui/Dialog";

export { getDialogFocusTarget as getUpdateDialogFocusTarget } from "../ui/Dialog";

export type UpdateExperienceState = "prompt" | UpdateInstallProgress["stage"];

export interface UpdateExperienceProgress {
  percent: number | null;
  text: string;
}

export interface UpdateExperienceProps {
  available: boolean;
  latestTag: string;
  currentVersion: string;
  releaseNotes: string;
  state: UpdateExperienceState;
  progress: UpdateExperienceProgress | number | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onInstall: () => void;
  onLater: () => void;
  renderTrigger?: boolean;
  renderDialog?: boolean;
}

const activeStates = new Set<UpdateExperienceState>([
  "starting",
  "downloading",
  "verifying",
  "launching"
]);

export function UpdateExperience({
  available,
  latestTag,
  currentVersion,
  releaseNotes,
  state,
  progress,
  open,
  onOpen,
  onClose,
  onInstall,
  onLater,
  renderTrigger = true,
  renderDialog = true
}: UpdateExperienceProps): ReactElement | null {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const progressInfo = typeof progress === "object" ? progress : null;
  const active = activeStates.has(state);
  const closable = !active;

  if (!available && !open) {
    return null;
  }

  return (
    <>
      {available && renderTrigger ? (
        <div
          className="md-update-anchor"
          onBlur={() => setTooltipOpen(false)}
          onFocus={() => setTooltipOpen(true)}
          onMouseEnter={() => setTooltipOpen(true)}
          onMouseLeave={() => setTooltipOpen(false)}
        >
          <button
            aria-describedby="md-update-tooltip"
            aria-label="Update verfügbar"
            className="md-update-trigger"
            onClick={onOpen}
            type="button"
          >
            Update verfügbar
          </button>
          <div
            aria-label="Update verfügbar"
            className={`md-update-tooltip${tooltipOpen ? " is-visible" : ""}`}
            id="md-update-tooltip"
            role="tooltip"
          >
            Eine neue Version ist bereit. Klicke hier, um sie zu installieren.
          </div>
        </div>
      ) : null}
      {renderDialog ? (
        <Dialog
          actions={state === "prompt" ? (
            <>
              <button className="btn" onClick={onLater} type="button">Später</button>
              <button className="btn primary" onClick={onInstall} type="button">Jetzt aktualisieren</button>
            </>
          ) : null}
          actionsClassName="md-update-dialog-actions"
          backdropClassName="md-update-backdrop"
          bodyClassName="md-update-dialog-body"
          className={`md-update-dialog md-update-dialog-${state}`}
          closable={closable}
          headerClassName="md-update-dialog-header"
          onClose={onClose}
          open={open}
          showCloseButton
          size="update"
          title="Update installieren"
        >
          {state === "prompt" ? (
            <>
              <p>{latestTag} ist verfügbar. Installierte Version: {currentVersion}.</p>
              {releaseNotes.trim() ? (
                <details className="md-update-release-notes">
                  <summary>Changelog anzeigen</summary>
                  <pre data-i18n-ignore="true">{releaseNotes}</pre>
                </details>
              ) : null}
            </>
          ) : (
            <>
              <p className="md-update-progress-text">{progressInfo?.text ?? "Update wird vorbereitet..."}</p>
              {state === "downloading" && progressInfo?.percent !== null && progressInfo?.percent !== undefined ? (
                <div
                  aria-label="Update-Fortschritt"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progressInfo.percent}
                  className="md-update-progress-track"
                  role="progressbar"
                >
                  <div className="md-update-progress-fill" style={{ width: `${progressInfo.percent}%` }} />
                </div>
              ) : null}
            </>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
