export function startRendererPerformanceMonitor(send: (sample: Record<string, number | boolean>) => void) {
  let last = performance.now();
  let longTasks = 0;
  let longTaskTotalMs = 0;
  let longTaskMaxMs = 0;
  let scrollEvents = 0;
  let scrollFrames = 0;
  let scrollFrameMaxMs = 0;
  let stateUpdates = 0;
  let scrollUntil = 0;
  let lastFrame = 0;
  let framePending = false;
  let longTasksSupported = false;
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        longTasks++;
        longTaskTotalMs += entry.duration;
        longTaskMaxMs = Math.max(longTaskMaxMs, entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    longTasksSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
  } catch {}
  const frame = (now: number) => {
    framePending = false;
    if (document.visibilityState !== "visible") return;
    if (lastFrame) {
      scrollFrames++;
      scrollFrameMaxMs = Math.max(scrollFrameMaxMs, now - lastFrame);
    }
    lastFrame = now;
    if (now < scrollUntil) {
      framePending = true;
      requestAnimationFrame(frame);
    }
  };
  document.addEventListener("scroll", () => {
    scrollEvents++;
    scrollUntil = performance.now() + 500;
    if (!framePending) {
      lastFrame = 0;
      framePending = true;
      requestAnimationFrame(frame);
    }
  }, { capture: true, passive: true });
  setInterval(() => {
    const now = performance.now();
    send({ at: Date.now(), intervalMs: now - last, timerDelayMs: Math.max(0, now - last - 5000), longTasks, longTaskTotalMs, longTaskMaxMs, scrollEvents, scrollFrames, scrollFrameMaxMs, stateUpdates, visible: document.visibilityState === "visible", longTasksSupported });
    last = now;
    longTasks = longTaskTotalMs = longTaskMaxMs = scrollEvents = scrollFrames = scrollFrameMaxMs = stateUpdates = 0;
  }, 5000);
  return { stateUpdate: () => { stateUpdates++; } };
}
