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
      expect(manager.removeOfflinePackages([...confirmed, confirmed[0], "missing"])).toBe(2);
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
