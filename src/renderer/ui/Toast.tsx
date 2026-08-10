import type { ReactElement } from "react";

export interface ToastProps {
  message: string;
}

export function Toast({ message }: ToastProps): ReactElement | null {
  if (!message) {
    return null;
  }
  return <div aria-live="polite" className="toast md-toast" role="status">{message}</div>;
}
