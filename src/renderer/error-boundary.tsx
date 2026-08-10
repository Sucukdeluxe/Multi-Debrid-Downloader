import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

// Catches render-time errors in the component tree so a crash shows a minimal
// recovery surface instead of a silent white screen, and forwards the error to
// the main process log. Kept deliberately dead-simple and state-independent: an
// error inside the error path is how you get a second white screen or a loop.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    try {
      window.rd?.reportRendererError({
        kind: "react",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        componentStack: info?.componentStack || undefined
      });
    } catch {
    }
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div
        className="ui-error-boundary"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        aria-labelledby="renderer-error-title"
        aria-describedby="renderer-error-description renderer-error-details"
      >
        <div className="ui-error-boundary-content">
          <h1 className="ui-error-boundary-title" id="renderer-error-title">
            Die Oberfläche hat einen Fehler ausgelöst
          </h1>
          <p className="ui-error-boundary-description" id="renderer-error-description">
            Die Anzeige wurde gestoppt, um Datenverlust zu vermeiden. Die laufenden Downloads im
            Hintergrund sind nicht betroffen. Der Fehler wurde ins Log geschrieben.
          </p>
          <pre className="ui-error-boundary-details" id="renderer-error-details" tabIndex={0}>
            {this.state.message}
          </pre>
          <button
            autoFocus
            className="ui-error-boundary-reload"
            type="button"
            onClick={this.handleReload}
          >
            Oberfläche neu laden
          </button>
        </div>
      </div>
    );
  }
}
