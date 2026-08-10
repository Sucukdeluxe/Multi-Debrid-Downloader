export type FocusRestoreScheduler = (callback: () => void) => void;

export function getConnectedFocusTarget(
  preferredTarget: HTMLElement | null,
  fallbackTarget: HTMLElement | null = null
): HTMLElement | null {
  if (preferredTarget?.isConnected) {
    return preferredTarget;
  }

  return fallbackTarget?.isConnected ? fallbackTarget : null;
}

export function restoreFocus(
  preferredTarget: HTMLElement | null,
  fallbackTarget: HTMLElement | null = null,
  schedule: FocusRestoreScheduler = queueMicrotask
): void {
  schedule(() => {
    getConnectedFocusTarget(preferredTarget, fallbackTarget)?.focus();
  });
}
