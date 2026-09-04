import { describe, expect, it } from "vitest";
import { createPackageOrderState } from "../src/renderer/package-order-state";

describe("pending package order", () => {
  it("keeps the chosen order through stale updates until the command and snapshot agree", () => {
    const state = createPackageOrderState();
    state.accept(["a", "b", "c"]);
    const request = state.begin(["c", "b", "a"]);
    expect(state.accept(["a", "b", "c"])).toEqual(["c", "b", "a"]);
    state.confirm(request);
    expect(state.accept(["a", "b", "c"])).toEqual(["c", "b", "a"]);
    expect(state.accept(["c", "b", "a"])).toEqual(["c", "b", "a"]);
    expect(state.accept(["b", "a", "c"])).toEqual(["b", "a", "c"]);
  });

  it("does not mistake the old order for confirmation when the user reverses quickly", () => {
    const state = createPackageOrderState();
    state.accept(["a", "b"]);
    const first = state.begin(["b", "a"]);
    const second = state.begin(["a", "b"]);
    expect(state.accept(["a", "b"])).toEqual(["a", "b"]);
    state.confirm(first);
    expect(state.accept(["b", "a"])).toEqual(["a", "b"]);
    state.confirm(second);
    expect(state.accept(["b", "a"])).toEqual(["a", "b"]);
    state.accept(["a", "b"]);
    expect(state.accept(["b", "a"])).toEqual(["b", "a"]);
  });

  it("retains newly added packages and never resurrects removed packages", () => {
    const state = createPackageOrderState();
    state.accept(["a", "b", "c"]);
    const request = state.begin(["c", "b", "a"]);
    expect(state.accept(["a", "c", "new"])).toEqual(["c", "a", "new"]);
    state.confirm(request);
    state.accept(["c", "a", "new"]);
    expect(state.accept(["new", "a", "c"])).toEqual(["new", "a", "c"]);
  });

  it("ignores rejected obsolete requests and rolls back the current request to the latest server order", () => {
    const state = createPackageOrderState();
    state.accept(["a", "b"]);
    const first = state.begin(["b", "a"]);
    const second = state.begin(["a", "b"]);
    expect(state.reject(first)).toBeNull();
    state.accept(["b", "a", "new"]);
    expect(state.reject(second)).toEqual(["b", "a", "new"]);
    expect(state.accept(["new", "b", "a"])).toEqual(["new", "b", "a"]);
  });

  it("can receive the matching snapshot before the command promise resolves", () => {
    const state = createPackageOrderState();
    state.accept(["a", "b"]);
    const request = state.begin(["b", "a"]);
    state.accept(["b", "a"]);
    state.confirm(request);
    const incoming = ["b", "a"];
    expect(state.accept(incoming)).toBe(incoming);
    expect(state.accept(["a", "b"])).toEqual(["a", "b"]);
  });

  it("preserves an empty authoritative queue", () => {
    const state = createPackageOrderState();
    const request = state.begin(["b", "a"]);
    state.confirm(request);
    expect(state.accept([])).toEqual([]);
    expect(state.accept(["new"])).toEqual(["new"]);
  });
});
