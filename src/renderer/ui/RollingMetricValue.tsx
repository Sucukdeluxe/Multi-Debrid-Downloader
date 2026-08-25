import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";

export type RollingMetricDirection = "up" | "down" | "none";

interface RollingMetricValueProps {
  numericValue: number;
  value: string;
}

interface RollingMetricTransition {
  direction: Exclude<RollingMetricDirection, "none">;
  from: string;
  id: number;
  to: string;
}

const useMetricLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function getRollingMetricDirection(previous: number, next: number): RollingMetricDirection {
  if (next > previous) return "up";
  if (next < previous) return "down";
  return "none";
}

export function shouldAnimateRollingMetric(previousValue: string, nextValue: string): boolean {
  return previousValue !== nextValue;
}

export function RollingMetricValue({ numericValue, value }: RollingMetricValueProps): ReactElement {
  const previousRef = useRef({ numericValue, value });
  const sequenceRef = useRef(0);
  const outgoingRef = useRef<HTMLSpanElement>(null);
  const incomingRef = useRef<HTMLSpanElement>(null);
  const [transition, setTransition] = useState<RollingMetricTransition | null>(null);

  useMetricLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { numericValue, value };
    if (!shouldAnimateRollingMetric(previous.value, value)) return;
    const direction = getRollingMetricDirection(previous.numericValue, numericValue);
    if (direction === "none") {
      setTransition(null);
      return;
    }
    sequenceRef.current += 1;
    setTransition({ direction, from: previous.value, id: sequenceRef.current, to: value });
  }, [numericValue, value]);

  useMetricLayoutEffect(() => {
    if (!transition || !outgoingRef.current || !incomingRef.current) return;
    const distance = transition.direction === "up" ? -1 : 1;
    const options: KeyframeAnimationOptions = { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" };
    const outgoing = outgoingRef.current.animate([
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: `translateY(${distance * 115}%)` }
    ], options);
    const incoming = incomingRef.current.animate([
      { opacity: 0, transform: `translateY(${-distance * 115}%)` },
      { opacity: 1, transform: "translateY(0)" }
    ], options);
    let active = true;
    Promise.all([outgoing.finished, incoming.finished]).then(() => {
      if (active) setTransition((current) => current?.id === transition.id ? null : current);
    }).catch(() => {});
    return () => {
      active = false;
      outgoing.cancel();
      incoming.cancel();
    };
  }, [transition]);

  return (
    <strong aria-label={value} className="downloads-rolling-value" data-direction={transition?.direction ?? "none"}>
      {transition
        ? <><span aria-hidden="true" className="downloads-rolling-value-layer is-outgoing" ref={outgoingRef}>{transition.from}</span><span aria-hidden="true" className="downloads-rolling-value-layer is-incoming" ref={incomingRef}>{transition.to}</span></>
        : <span aria-hidden="true" className="downloads-rolling-value-layer">{value}</span>}
    </strong>
  );
}
