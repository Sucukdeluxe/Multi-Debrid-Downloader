import { Children, Fragment, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface ContextInfoButtonProps {
  contextName: string;
  content: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function hasRenderableContent(content: ReactNode): boolean {
  if (content === null || content === undefined || typeof content === "boolean") {
    return false;
  }
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (typeof content === "number") {
    return true;
  }
  if (Array.isArray(content)) {
    return content.some(hasRenderableContent);
  }
  if (isValidElement<{ children?: ReactNode }>(content) && content.type === Fragment) {
    return hasRenderableContent(content.props.children);
  }
  if (isValidElement(content)) {
    return true;
  }
  return Children.toArray(content).some(hasRenderableContent);
}

export function ContextInfoButton({
  contextName,
  content,
  open,
  onOpenChange
}: ContextInfoButtonProps): ReactElement | null {
  const regionId = useId();

  if (!hasRenderableContent(content)) {
    return null;
  }

  return (
    <div className="ui-context-info">
      <button
        aria-controls={regionId}
        aria-expanded={open}
        aria-label="Informationen"
        className="ui-context-info-trigger"
        onClick={() => onOpenChange(!open)}
        title="Informationen"
        type="button"
      >
        <Icon name="info" size={18} />
      </button>
      {open ? (
        <div
          aria-label={`Informationen zu ${contextName}`}
          className="ui-context-info-region"
          id={regionId}
          role="region"
        >
          {content}
        </div>
      ) : null}
    </div>
  );
}
