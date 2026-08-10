import { createElement, useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactElement, type ReactNode } from "react";

const useSelectionLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface SlidingSelectionProps extends HTMLAttributes<HTMLElement> {
  activeKey: string;
  as?: "div" | "nav";
  axis: "horizontal" | "vertical";
  children: ReactNode;
}

export function scheduleSelectionLayout(
  hasPosition: boolean,
  frame: number,
  apply: () => void,
  requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (frame: number) => void = cancelAnimationFrame,
  enableTransitions: () => void = () => {}
): number {
  if (!hasPosition) {
    apply();
    return requestFrame(enableTransitions);
  }
  cancelFrame(frame);
  return requestFrame(apply);
}

export function SlidingSelection({ activeKey, as = "div", axis, children, className = "", ...attributes }: SlidingSelectionProps): ReactElement {
  const ref = useRef<HTMLElement>(null);
  const hasPositionRef = useRef(false);

  useSelectionLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    let transitionFrame = 0;
    const applyLayout = (): void => {
      const active = element.querySelector<HTMLElement>('[data-sliding-selection-active="true"]');
      if (!active) {
        element.style.setProperty("--ui-sliding-selection-width", "0px");
        element.style.setProperty("--ui-sliding-selection-height", "0px");
        return;
      }
      const containerRect = element.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      element.style.setProperty("--ui-sliding-selection-x", `${activeRect.left - containerRect.left + element.scrollLeft}px`);
      element.style.setProperty("--ui-sliding-selection-y", `${activeRect.top - containerRect.top + element.scrollTop}px`);
      element.style.setProperty("--ui-sliding-selection-width", `${activeRect.width}px`);
      element.style.setProperty("--ui-sliding-selection-height", `${activeRect.height}px`);
      hasPositionRef.current = true;
    };
    const sync = (): void => {
      if (!hasPositionRef.current) {
        transitionFrame = scheduleSelectionLayout(false, transitionFrame, applyLayout, requestAnimationFrame, cancelAnimationFrame, () => {
          if (hasPositionRef.current) {
            element.style.setProperty("--ui-sliding-selection-duration", "420ms");
          }
        });
        return;
      }
      frame = scheduleSelectionLayout(hasPositionRef.current, frame, applyLayout);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(element);
    element.querySelectorAll<HTMLElement>('[data-sliding-selection-item="true"]').forEach((item) => observer?.observe(item));
    element.addEventListener("scroll", sync, { passive: true });
    sync();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(transitionFrame);
      observer?.disconnect();
      element.removeEventListener("scroll", sync);
    };
  }, [activeKey]);

  return createElement(as, {
    ...attributes,
    className: `ui-sliding-selection ui-sliding-selection-${axis}${className ? ` ${className}` : ""}`,
    ref
  }, children);
}
