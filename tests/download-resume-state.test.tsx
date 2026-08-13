import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { createRendererState } from "../src/main/renderer-state";
import { emptySession } from "../src/main/storage";
import type { UiSnapshot } from "../src/shared/types";

const hookState = vi.hoisted(() => ({
  capturedSnapshot: false,
  currentSnapshot: null as unknown,
  initialSnapshot: null as unknown
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    memo: <T,>(component: T): T => component,
    useCallback: <T,>(callback: T): T => callback,
    useDeferredValue: <T,>(value: T): T => value,
    useEffect: (): void => {},
    useLayoutEffect: (): void => {},
    useMemo: <T,>(factory: () => T): T => factory(),
    useRef: <T,>(initial: T): { current: T } => ({ current: initial }),
    useState: <T,>(initial: T | (() => T)): [T, (next: T | ((current: T) => T)) => void] => {
      const initialValue = typeof initial === "function" ? (initial as () => T)() : initial;
      const candidate = initialValue as Record<string, unknown> | null;
      if (!hookState.capturedSnapshot && candidate && "session" in candidate && "canStart" in candidate) {
        hookState.capturedSnapshot = true;
        const setSnapshot = (next: T | ((current: T) => T)): void => {
          const current = hookState.currentSnapshot as T;
          hookState.currentSnapshot = typeof next === "function"
            ? (next as (value: T) => T)(current)
            : next;
        };
        return [hookState.initialSnapshot as T, setSnapshot];
      }
      let current = initialValue;
      return [current, (next): void => {
        current = typeof next === "function" ? (next as (value: T) => T)(current) : next;
      }];
    }
  };
});

import { App } from "../src/renderer/App";

function createSnapshot(running: boolean, paused: boolean): UiSnapshot {
  const now = Date.now();
  return {
    ...createRendererState(defaultSettings()),
    session: {
      ...emptySession(),
      running,
      paused,
      updatedAt: now
    },
    summary: null,
    stats: {
      totalDownloaded: 0,
      totalDownloadedAllTime: 0,
      totalFilesSession: 0,
      totalFilesAllTime: 0,
      totalPackages: 0,
      sessionStartedAt: now,
      appSessionStartedAt: now,
      sessionRuntimeMs: 0,
      totalRuntimeMs: 0,
      runtimeMeasuredAt: now
    },
    speedText: "Geschwindigkeit: 0 B/s",
    etaText: "ETA: --",
    canStart: !running || paused,
    canStop: running,
    canPause: running,
    clipboardActive: false,
    reconnectSeconds: 0,
    packageSpeedBps: {}
  };
}

function findStartAction(node: ReactNode): (() => void) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const action = findStartAction(child);
      if (action) return action;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as {
    actions?: { onStartDownloads?: () => void };
    children?: ReactNode;
    toolbar?: ReactNode;
  };
  if (typeof props.actions?.onStartDownloads === "function") {
    return props.actions.onStartDownloads;
  }
  return findStartAction(props.toolbar) ?? findStartAction(props.children);
}

async function flushAsyncAction(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function renderPausedStartAction(
  initialSnapshot: UiSnapshot,
  togglePause: () => Promise<boolean>,
  getSnapshot: () => Promise<UiSnapshot>
): () => void {
  hookState.capturedSnapshot = false;
  hookState.initialSnapshot = initialSnapshot;
  hookState.currentSnapshot = initialSnapshot;
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", {
    activeElement: null,
    body: {},
    documentElement: {},
    querySelector: () => null
  });
  vi.stubGlobal("window", {
    addEventListener: () => {},
    clearInterval,
    clearTimeout,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    prompt: () => null,
    rd: { getSnapshot, togglePause },
    removeEventListener: () => {},
    setInterval,
    setTimeout
  });
  const action = findStartAction(App() as ReactElement);
  if (!action) throw new Error("Download-Startaktion nicht gefunden");
  return action;
}

describe("paused download resume reconciliation", () => {
  beforeEach(() => {
    hookState.capturedSnapshot = false;
    hookState.currentSnapshot = null;
    hookState.initialSnapshot = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores the authoritative paused state when togglePause rejects without a state event", async () => {
    const initial = createSnapshot(true, true);
    const authoritative = createSnapshot(true, true);
    const action = renderPausedStartAction(
      initial,
      async () => { throw new Error("Kein aktiver Download-Account verfügbar"); },
      async () => authoritative
    );

    action();
    await flushAsyncAction();

    expect(hookState.currentSnapshot).toEqual(authoritative);
  });

  it("replaces stale running state when togglePause returns false without a state event", async () => {
    const initial = createSnapshot(true, true);
    const authoritative = createSnapshot(false, false);
    const action = renderPausedStartAction(
      initial,
      async () => false,
      async () => authoritative
    );

    action();
    await flushAsyncAction();

    expect(hookState.currentSnapshot).toEqual(authoritative);
  });
});
