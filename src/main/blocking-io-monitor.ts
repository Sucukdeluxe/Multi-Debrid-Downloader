import fs from "node:fs";
import childProcess from "node:child_process";
import os from "node:os";
import type { RuntimePerformance, RuntimeOperation } from "./runtime-performance";

type Target = { name: string; target: object; methods: string[] };

export function installBlockingIoMonitor(performance: RuntimePerformance, targets: Target[] = [
  { name: "fs", target: fs, methods: ["accessSync", "existsSync", "statSync", "lstatSync", "statfsSync", "readdirSync", "readFileSync", "writeFileSync", "appendFileSync", "openSync", "closeSync", "readSync", "writeSync", "mkdirSync", "renameSync", "unlinkSync", "rmSync", "fsyncSync"] },
  { name: "process", target: childProcess, methods: ["spawn", "spawnSync", "execFileSync", "execSync"] },
  { name: "os", target: os, methods: ["setPriority"] }
]): () => void {
  const restores: Array<() => void> = [];
  for (const { name, target, methods } of targets) {
    const object = target as Record<string, unknown>;
    for (const method of methods) {
      const original = object[method];
      if (typeof original !== "function") continue;
      const wrapped = function (this: unknown, ...args: unknown[]): unknown {
        return performance.measureSync(`io.${name}.${method}` as RuntimeOperation, () => Reflect.apply(original, this, args));
      };
      Object.assign(wrapped, original);
      object[method] = wrapped;
      restores.push(() => { if (object[method] === wrapped) object[method] = original; });
    }
  }
  return () => { for (const restore of restores.reverse()) restore(); };
}
