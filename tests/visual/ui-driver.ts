import { VISUAL_SCENARIOS, type VisualScenario } from "./fixtures";

export type MainViewId = "downloads" | "collector" | "settings" | "history" | "statistics";

export interface VisualInteraction {
  type: "click" | "hover" | "fill" | "press" | "wait-visible" | "wait-absent";
  role?: string;
  name?: string;
  value?: string;
  key?: string;
}

export interface VisualAssertion {
  type: "active-view" | "visible" | "absent" | "nonempty" | "minimum-row-count" | "layer-above";
  role?: string;
  name?: string;
  region?: string;
  value?: string | number;
  referenceRole?: string;
  referenceName?: string;
}

export interface VisualCapture {
  name: string;
  scenario: VisualScenario;
  viewport: {
    width: number;
    height: number;
  };
  activeView: MainViewId;
  interactions: VisualInteraction[];
  assertions: VisualAssertion[];
}

const MAIN_VIEWS = ["downloads", "collector", "settings", "history", "statistics"] as const;
const INTERACTION_TYPES = ["click", "hover", "fill", "press", "wait-visible", "wait-absent"] as const;
const ASSERTION_TYPES = ["active-view", "visible", "absent", "nonempty", "minimum-row-count", "layer-above"] as const;
const REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VIEW_NAMES: Record<MainViewId, string> = {
  downloads: "Downloads",
  collector: "Linksammler",
  settings: "Einstellungen",
  history: "Verlauf",
  statistics: "Statistiken"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function validateRoleName(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (!isNonemptyString(value.role)) {
    errors.push(`${path}.role must be a nonempty string`);
  }
  if (!isNonemptyString(value.name)) {
    errors.push(`${path}.name must be a nonempty string`);
  }
}

function validateRegion(value: unknown, path: string, errors: string[]): void {
  if (!isNonemptyString(value) || !REGION_PATTERN.test(value)) {
    errors.push(`${path} must match ^[a-z0-9]+(?:-[a-z0-9]+)*$`);
  }
}

function validateInteraction(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isOneOf(value.type, INTERACTION_TYPES)) {
    errors.push(`${path}.type must be one of ${INTERACTION_TYPES.join(", ")}`);
    return;
  }
  validateRoleName(value, path, errors);
  if (value.type === "fill" && typeof value.value !== "string") {
    errors.push(`${path}.value must be a string`);
  }
  if (value.type === "press" && !isNonemptyString(value.key)) {
    errors.push(`${path}.key must be a nonempty string`);
  }
}

function validateAssertion(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isOneOf(value.type, ASSERTION_TYPES)) {
    errors.push(`${path}.type must be one of ${ASSERTION_TYPES.join(", ")}`);
    return;
  }
  if (value.type === "active-view") {
    if (!isOneOf(value.value, MAIN_VIEWS)) {
      errors.push(`${path}.value must be one of ${MAIN_VIEWS.join(", ")}`);
    }
    return;
  }
  if (value.type === "minimum-row-count") {
    validateRegion(value.region, `${path}.region`, errors);
    if (!Number.isInteger(value.value) || Number(value.value) < 0) {
      errors.push(`${path}.value must be a nonnegative integer`);
    }
    return;
  }
  if (value.type === "layer-above") {
    validateRoleName(value, path, errors);
    if (!isNonemptyString(value.referenceRole)) {
      errors.push(`${path}.referenceRole must be a nonempty string`);
    }
    if (!isNonemptyString(value.referenceName)) {
      errors.push(`${path}.referenceName must be a nonempty string`);
    }
    return;
  }
  if (value.region !== undefined) {
    validateRegion(value.region, `${path}.region`, errors);
    return;
  }
  validateRoleName(value, path, errors);
}

export function validateVisualCaptureManifest(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return ["$ must be an array"];
  }
  const errors: string[] = [];
  const names = new Set<string>();
  input.forEach((value, index) => {
    const path = `$[${index}]`;
    const entry = isRecord(value) ? value : {};
    if (!isRecord(value)) {
      errors.push(`${path} must be an object`);
    }
    if (!isNonemptyString(entry.name)) {
      errors.push(`${path}.name must be a nonempty string`);
    } else if (names.has(entry.name)) {
      errors.push(`${path}.name must be unique`);
    } else {
      names.add(entry.name);
    }
    if (!isOneOf(entry.scenario, VISUAL_SCENARIOS)) {
      errors.push(`${path}.scenario must be one of ${VISUAL_SCENARIOS.join(", ")}`);
    }
    if (!isRecord(entry.viewport)) {
      errors.push(`${path}.viewport must be an object`);
    } else {
      if (!Number.isInteger(entry.viewport.width) || Number(entry.viewport.width) <= 0) {
        errors.push(`${path}.viewport.width must be a positive integer`);
      }
      if (!Number.isInteger(entry.viewport.height) || Number(entry.viewport.height) <= 0) {
        errors.push(`${path}.viewport.height must be a positive integer`);
      }
    }
    if (!isOneOf(entry.activeView, MAIN_VIEWS)) {
      errors.push(`${path}.activeView must be one of ${MAIN_VIEWS.join(", ")}`);
    }
    if (!Array.isArray(entry.interactions)) {
      errors.push(`${path}.interactions must be an array`);
    } else {
      entry.interactions.forEach((interaction, interactionIndex) => {
        validateInteraction(interaction, `${path}.interactions[${interactionIndex}]`, errors);
      });
    }
    if (!Array.isArray(entry.assertions)) {
      errors.push(`${path}.assertions must be an array`);
    } else {
      entry.assertions.forEach((assertion, assertionIndex) => {
        validateAssertion(assertion, `${path}.assertions[${assertionIndex}]`, errors);
      });
    }
  });
  return errors;
}

export async function loadVisualCapture(name: string): Promise<VisualCapture> {
  const response = await fetch(new URL("./capture-manifest.json", import.meta.url));
  if (!response.ok) {
    throw new Error(`capture manifest could not be loaded: ${response.status}`);
  }
  const manifest: unknown = await response.json();
  const errors = validateVisualCaptureManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`capture manifest is invalid: ${errors.join("; ")}`);
  }
  const capture = (manifest as VisualCapture[]).find((entry) => entry.name === name);
  if (!capture) {
    throw new Error(`capture "${name}" is missing`);
  }
  return capture;
}

function roleForElement(element: Element): string | null {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) {
    return explicitRole;
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === "button") {
    return "button";
  }
  if (tagName === "textarea") {
    return "textbox";
  }
  if (tagName === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (["text", "email", "search", "tel", "url", "password"].includes(type)) {
      return "textbox";
    }
  }
  if (tagName === "section" && accessibleName(element).length > 0) {
    return "region";
  }
  return null;
}

function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel !== null) {
    return ariaLabel.trim();
  }
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ownerDocument = element.ownerDocument;
    const name = labelledBy
      .split(/\s+/)
      .map((id) => ownerDocument?.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (name) {
      return name;
    }
  }
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function isVisible(element: Element, targetDocument: Document): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
    return false;
  }
  const style = targetDocument.defaultView?.getComputedStyle(element);
  if (style && (
    style.display === "none"
    || style.visibility === "hidden"
    || style.visibility === "collapse"
    || style.opacity === "0"
  )) {
    return false;
  }
  return element.getClientRects().length > 0;
}

function targetLabel(role: string, name: string): string {
  return `${role} "${name}"`;
}

function roleMatches(targetDocument: Document, role: string, name: string): Element[] {
  return Array.from(targetDocument.querySelectorAll("*")).filter((element) => (
    roleForElement(element) === role
    && accessibleName(element) === name
    && isVisible(element, targetDocument)
  ));
}

function resolveRole(targetDocument: Document, role: string, name: string): Element {
  const matches = roleMatches(targetDocument, role, name);
  if (matches.length === 0) {
    throw new Error(`${targetLabel(role, name)} is missing`);
  }
  if (matches.length > 1) {
    throw new Error(`${targetLabel(role, name)} is ambiguous`);
  }
  return matches[0];
}

function regionMatches(targetDocument: Document, region: string): Element[] {
  if (!REGION_PATTERN.test(region)) {
    throw new Error(`region "${region}" is invalid`);
  }
  return Array.from(targetDocument.querySelectorAll("[data-visual-region]"))
    .filter((element) => element.getAttribute("data-visual-region") === region)
    .filter((element) => isVisible(element, targetDocument));
}

function resolveRegion(targetDocument: Document, region: string): Element {
  const matches = regionMatches(targetDocument, region);
  if (matches.length === 0) {
    throw new Error(`region marker "${region}" is missing`);
  }
  if (matches.length > 1) {
    throw new Error(`region marker "${region}" is ambiguous`);
  }
  return matches[0];
}

function requestFrame(targetDocument: Document): Promise<void> {
  return new Promise((resolve) => {
    const request = targetDocument.defaultView?.requestAnimationFrame;
    if (!request) {
      resolve();
      return;
    }
    request.call(targetDocument.defaultView, () => resolve());
  });
}

async function waitForStableDom(targetDocument: Document): Promise<void> {
  await requestFrame(targetDocument);
  await requestFrame(targetDocument);
}

function createEvent(targetDocument: Document, type: string, kind: "event" | "mouse" | "pointer" | "keyboard", key = ""): Event | null {
  const view = targetDocument.defaultView;
  if (!view) {
    return null;
  }
  if (kind === "keyboard") {
    return new view.KeyboardEvent(type, { bubbles: true, cancelable: true, key });
  }
  if (kind === "pointer" && typeof view.PointerEvent === "function") {
    return new view.PointerEvent(type, { bubbles: true, cancelable: true });
  }
  if (kind === "mouse" || kind === "pointer") {
    return new view.MouseEvent(type, { bubbles: true, cancelable: true });
  }
  return new view.Event(type, { bubbles: true, cancelable: true });
}

function dispatch(element: Element, event: Event | null): void {
  if (event && typeof element.dispatchEvent === "function") {
    element.dispatchEvent(event);
  }
}

function focusElement(element: Element): void {
  if ("focus" in element && typeof element.focus === "function") {
    element.focus();
  }
}

function clickElement(targetDocument: Document, element: Element): void {
  focusElement(element);
  dispatch(element, createEvent(targetDocument, "pointerdown", "pointer"));
  dispatch(element, createEvent(targetDocument, "mousedown", "mouse"));
  dispatch(element, createEvent(targetDocument, "pointerup", "pointer"));
  dispatch(element, createEvent(targetDocument, "mouseup", "mouse"));
  if ("click" in element && typeof element.click === "function") {
    element.click();
  } else {
    dispatch(element, createEvent(targetDocument, "click", "mouse"));
  }
}

function hoverElement(targetDocument: Document, element: Element): void {
  dispatch(element, createEvent(targetDocument, "pointerover", "pointer"));
  dispatch(element, createEvent(targetDocument, "pointerenter", "pointer"));
  dispatch(element, createEvent(targetDocument, "mouseover", "mouse"));
  dispatch(element, createEvent(targetDocument, "mouseenter", "mouse"));
}

function setNativeValue(targetDocument: Document, element: Element, value: string): void {
  const view = targetDocument.defaultView;
  if (!view) {
    throw new Error("document window is missing");
  }
  let prototype: object | null = Object.getPrototypeOf(element);
  let setter: ((this: Element, nextValue: string) => void) | undefined;
  while (prototype && !setter) {
    setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set as typeof setter;
    prototype = Object.getPrototypeOf(prototype);
  }
  if (!setter) {
    throw new Error("textbox native value setter is missing");
  }
  focusElement(element);
  setter.call(element, value);
  dispatch(element, createEvent(targetDocument, "input", "event"));
  dispatch(element, createEvent(targetDocument, "change", "event"));
}

function pressElement(targetDocument: Document, element: Element, key: string): void {
  focusElement(element);
  dispatch(element, createEvent(targetDocument, "keydown", "keyboard", key));
  dispatch(element, createEvent(targetDocument, "keyup", "keyboard", key));
}

async function waitForRoleState(
  targetDocument: Document,
  role: string,
  name: string,
  present: boolean,
  maxFrames = 180
): Promise<void> {
  for (let frame = 0; frame <= maxFrames; frame += 1) {
    const count = roleMatches(targetDocument, role, name).length;
    if ((present && count === 1) || (!present && count === 0)) {
      return;
    }
    if (present && count > 1) {
      throw new Error(`${targetLabel(role, name)} is ambiguous`);
    }
    if (frame < maxFrames) {
      await requestFrame(targetDocument);
    }
  }
  throw new Error(`${targetLabel(role, name)} did not become ${present ? "visible" : "absent"}`);
}

async function activateView(activeView: MainViewId, targetDocument: Document): Promise<void> {
  const name = VIEW_NAMES[activeView];
  const tabMatches = roleMatches(targetDocument, "tab", name);
  const buttonMatches = roleMatches(targetDocument, "button", name);
  const viewButtonMatches = buttonMatches.filter((element) => element.classList.contains("tab"));
  const matches = tabMatches.length > 0
    ? tabMatches
    : viewButtonMatches.length > 0
      ? viewButtonMatches
      : buttonMatches;
  if (matches.length === 0) {
    throw new Error(`tab or button "${name}" is missing`);
  }
  if (matches.length > 1) {
    throw new Error(`tab or button "${name}" is ambiguous`);
  }
  clickElement(targetDocument, matches[0]);
  await waitForStableDom(targetDocument);
}

async function runInteraction(interaction: VisualInteraction, targetDocument: Document): Promise<void> {
  const role = interaction.role as string;
  const name = interaction.name as string;
  if (interaction.type === "wait-visible" || interaction.type === "wait-absent") {
    await waitForRoleState(targetDocument, role, name, interaction.type === "wait-visible");
    await waitForStableDom(targetDocument);
    return;
  }
  const element = resolveRole(targetDocument, role, name);
  if (interaction.type === "click") {
    clickElement(targetDocument, element);
  } else if (interaction.type === "hover") {
    hoverElement(targetDocument, element);
  } else if (interaction.type === "fill") {
    setNativeValue(targetDocument, element, interaction.value as string);
  } else {
    pressElement(targetDocument, element, interaction.key as string);
  }
  await waitForStableDom(targetDocument);
}

function resolveAssertionElement(assertion: VisualAssertion, targetDocument: Document): Element {
  if (assertion.region) {
    return resolveRegion(targetDocument, assertion.region);
  }
  return resolveRole(targetDocument, assertion.role as string, assertion.name as string);
}

function assertActiveView(activeView: MainViewId, targetDocument: Document): void {
  const marker = targetDocument.querySelector(`[data-visual-active-view="${activeView}"]`);
  if (marker && isVisible(marker, targetDocument)) {
    return;
  }
  const name = VIEW_NAMES[activeView];
  const candidates = [
    ...roleMatches(targetDocument, "tab", name),
    ...roleMatches(targetDocument, "button", name)
  ];
  const active = candidates.filter((element) => (
    element.getAttribute("aria-current") === "page"
    || element.getAttribute("aria-selected") === "true"
    || element.classList.contains("active")
  ));
  if (active.length !== 1) {
    throw new Error(`active view "${activeView}" is missing`);
  }
}

function rowCount(element: Element, targetDocument: Document): number {
  return Array.from(element.querySelectorAll('[role="row"]')).filter((row) => isVisible(row, targetDocument)).length;
}

function assertCapture(assertion: VisualAssertion, targetDocument: Document): void {
  if (assertion.type === "active-view") {
    assertActiveView(assertion.value as MainViewId, targetDocument);
    return;
  }
  if (assertion.type === "absent") {
    if (assertion.region) {
      const matches = regionMatches(targetDocument, assertion.region);
      if (matches.length > 1) {
        throw new Error(`region marker "${assertion.region}" is ambiguous`);
      }
      if (matches.length > 0) {
        throw new Error(`region marker "${assertion.region}" is visible`);
      }
    } else {
      const matches = roleMatches(targetDocument, assertion.role as string, assertion.name as string);
      if (matches.length > 0) {
        throw new Error(`${targetLabel(assertion.role as string, assertion.name as string)} is visible`);
      }
    }
    return;
  }
  const element = resolveAssertionElement(assertion, targetDocument);
  if (assertion.type === "visible") {
    return;
  }
  if (assertion.type === "nonempty") {
    if (!(element.textContent ?? "").trim()) {
      throw new Error(`${assertion.region ? `region marker "${assertion.region}"` : targetLabel(assertion.role as string, assertion.name as string)} is empty`);
    }
    return;
  }
  if (assertion.type === "minimum-row-count") {
    const count = rowCount(element, targetDocument);
    if (count < Number(assertion.value)) {
      throw new Error(`region marker "${assertion.region}" has ${count} rows, expected at least ${assertion.value}`);
    }
    return;
  }
  const reference = resolveRole(targetDocument, assertion.referenceRole as string, assertion.referenceName as string);
  const view = targetDocument.defaultView;
  const zIndex = Number.parseInt(view?.getComputedStyle(element).zIndex ?? "", 10);
  const referenceZIndex = Number.parseInt(view?.getComputedStyle(reference).zIndex ?? "", 10);
  if (!Number.isFinite(zIndex) || !Number.isFinite(referenceZIndex) || zIndex <= referenceZIndex) {
    throw new Error(`${targetLabel(assertion.role as string, assertion.name as string)} is not layered above ${targetLabel(assertion.referenceRole as string, assertion.referenceName as string)}`);
  }
}

export async function prepareVisualCapture(capture: VisualCapture, targetDocument: Document): Promise<void> {
  await activateView(capture.activeView, targetDocument);
  for (const interaction of capture.interactions) {
    await runInteraction(interaction, targetDocument);
  }
  for (const assertion of capture.assertions) {
    assertCapture(assertion, targetDocument);
  }
  await waitForStableDom(targetDocument);
}
