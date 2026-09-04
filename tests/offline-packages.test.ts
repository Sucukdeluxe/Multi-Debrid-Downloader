import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DownloadManager } from "../src/main/download-manager";
import { defaultSettings } from "../src/main/constants";
import { createStoragePaths, emptySession } from "../src/main/storage";
import { getPackagesWithOfflineLinks } from "../src/shared/offline-packages";
import type { SessionState } from "../src/shared/types";

describe("remove packages containing offline links", () => {
  it.each([
    ["episode03.part1.rar", "episode03.part2.rar"],
    ["episode03.rar", "episode03.r00"],
    ["episode03.zip.001", "episode03.zip.002"],
    ["episode03.7z.001", "episode03.7z.002"],
    ["episode03.001", "episode03.002"]
  ])("removes the archive set containing offline %s and keeps other episodes", async (first, second) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-offline-archive-"));
    const manager = new DownloadManager({ ...defaultSettings(), outputDir: root, autoExtract: false }, emptySession(), createStoragePaths(path.join(root, "state")));
    try {
      const names = [first, second, "episode04.part1.rar", "episode04.part2.rar", "notes.txt"];
      manager.addPackages([{ name: "Season", links: names.map((name) => `https://dummy/${name}`), fileNames: names }]);
      const session = (manager as unknown as { session: SessionState }).session;
      const pkg = session.packages[session.packageOrder[0]];
      const ids = [...pkg.itemIds];
      fs.mkdirSync(pkg.outputDir, { recursive: true });
      for (const [index, id] of ids.entries()) {
        session.items[id].fileName = names[index];
        session.items[id].targetPath = path.join(pkg.outputDir, names[index]);
        session.items[id].onlineStatus = index === 1 ? "offline" : "online";
        fs.writeFileSync(session.items[id].targetPath, names[index]);
      }
      session.items[ids[0]].status = "completed";
      expect(manager.removeOfflinePackages([pkg.id])).toBe(1);
      await (manager as any).cleanupQueue;
      expect(pkg.itemIds).toEqual(ids.slice(2));
      expect(session.items[ids[0]]).toBeUndefined();
      expect(session.items[ids[1]]).toBeUndefined();
      expect(session.packageOrder).toEqual([pkg.id]);
      for (const name of names) expect(fs.readFileSync(path.join(pkg.outputDir, name), "utf8")).toBe(name);
    } finally {
      manager.clearPersistTimer();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes complete partial and offline packages, preserves files and rechecks the confirmed set", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-offline-removal-"));
    const manager = new DownloadManager({ ...defaultSettings(), outputDir: root, autoExtract: false }, emptySession(), createStoragePaths(path.join(root, "state")));
    try {
      manager.addPackages(["partial", "offline", "online", "unknown", "recovered", "not-confirmed"].map((name) => ({
        name, links: [`https://dummy/${name}/one.rar`, `https://dummy/${name}/two.rar`]
      })));
      const session = (manager as unknown as { session: SessionState }).session;
      const packages = Object.fromEntries(Object.values(session.packages).map((entry) => [entry.name, entry]));
      for (const name of ["partial", "offline", "recovered", "not-confirmed"]) session.items[packages[name].itemIds[0]].onlineStatus = "offline";
      session.items[packages.partial.itemIds[1]].onlineStatus = "online";
      session.items[packages.offline.itemIds[1]].onlineStatus = "offline";
      for (const id of packages.online.itemIds) session.items[id].onlineStatus = "online";
      const confirmed = getPackagesWithOfflineLinks(session.packageOrder, session.packages, session.items).filter((id) => id !== packages["not-confirmed"].id);
      expect(confirmed).toHaveLength(3);
      session.items[packages.recovered.itemIds[0]].onlineStatus = "online";
      const preservedPaths = ["episode.rar", "episode.mkv", "episode.part"].map((name) => path.join(packages.partial.outputDir, name));
      fs.mkdirSync(packages.partial.outputDir, { recursive: true });
      for (const file of preservedPaths) fs.writeFileSync(file, "keep this content");
      const active = { abortController: new AbortController(), abortReason: "none" };
      (manager as any).activeTasks.set(packages.partial.itemIds[1], active);
      expect(manager.removeOfflinePackages([...confirmed, confirmed[0], "missing"], "package")).toBe(2);
      await (manager as any).cleanupQueue;
      expect(active.abortController.signal.aborted).toBe(true);
      expect(active.abortReason).toBe("stop");
      expect(Object.values(session.packages).map((entry) => entry.name)).toEqual(["online", "unknown", "recovered", "not-confirmed"]);
      for (const id of [...packages.partial.itemIds, ...packages.offline.itemIds]) expect(session.items[id]).toBeUndefined();
      for (const file of preservedPaths) expect(fs.readFileSync(file, "utf8")).toBe("keep this content");
      expect(manager.removeOfflinePackages(confirmed)).toBe(0);
    } finally {
      manager.clearPersistTimer();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
