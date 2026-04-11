import { renameSync, writeFileSync } from "node:fs";

export function atomicWriteFile(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}
