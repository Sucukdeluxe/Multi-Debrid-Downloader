export interface InstallResumeManager {
  isSessionRunning(): boolean;
  stop(options: { parkForRestart: boolean }): void;
  persistNowSync(): void;
  start(): Promise<void> | void;
}

export async function runInstallWithResume<T extends { started: boolean }>(
  manager: InstallResumeManager,
  doInstall: (park: () => void) => Promise<T>,
  deferParking = false
): Promise<T> {
  let wasRunning = false;
  let parked = false;
  const park = (): void => {
    if (parked) return;
    wasRunning = manager.isSessionRunning();
    parked = true;
    if (wasRunning) manager.stop({ parkForRestart: true });
    manager.persistNowSync();
  };

  const resumeIfParked = async (): Promise<void> => {
    if (wasRunning && !manager.isSessionRunning()) {
      await manager.start();
    }
  };

  try {
    if (!deferParking) park();
    const result = await doInstall(park);
    if (!result.started) {
      await resumeIfParked();
    }
    return result;
  } catch (error) {
    await resumeIfParked();
    throw error;
  }
}
