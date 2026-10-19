export function disableTabNavigation(target: Window): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  target.addEventListener("keydown", onKeyDown, true);
  return () => target.removeEventListener("keydown", onKeyDown, true);
}
