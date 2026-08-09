export interface DownloadSpeedHistoryState {
  history: number[];
  display: number;
}

export const DOWNLOAD_SPEED_MAX_SAMPLES = 160;

export function updateDownloadSpeedHistory(
  state: DownloadSpeedHistoryState,
  target: number,
  maxSamples = DOWNLOAD_SPEED_MAX_SAMPLES
): DownloadSpeedHistoryState {
  const safeTarget = Math.max(0, Number.isFinite(target) ? target : 0);
  const alpha = safeTarget > state.display ? 0.45 : 0.12;
  let display = state.display + (safeTarget - state.display) * alpha;
  if (display < 1) {
    display = 0;
  }
  const history = [...state.history, display];
  if (history.length > maxSamples) {
    history.splice(0, history.length - maxSamples);
  }
  return { history, display };
}
