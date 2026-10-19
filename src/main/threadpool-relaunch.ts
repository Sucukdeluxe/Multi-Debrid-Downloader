export const DESIRED_THREADPOOL_SIZE = 32;

type RelaunchApp = {
  isPackaged: boolean;
  relaunch: () => void;
};

export function relaunchWithThreadpoolSize(app: RelaunchApp, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!app.isPackaged || env.PORTABLE_EXECUTABLE_DIR || env.MDD_THREADPOOL_RELAUNCHED) {
    return false;
  }
  const configured = Number(env.UV_THREADPOOL_SIZE);
  if (Number.isInteger(configured) && configured >= DESIRED_THREADPOOL_SIZE) {
    return false;
  }
  env.UV_THREADPOOL_SIZE = String(DESIRED_THREADPOOL_SIZE);
  env.MDD_THREADPOOL_RELAUNCHED = "1";
  app.relaunch();
  return true;
}
