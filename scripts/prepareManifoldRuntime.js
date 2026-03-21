import { spawnSync } from "child_process";
import { MANIFOLD_SOURCE_LOCAL, writeManifoldSource } from "./manifoldSourceConfig.js";

const rootDir = process.cwd();
writeManifoldSource(MANIFOLD_SOURCE_LOCAL);

console.log("[prepareManifoldRuntime] Using locally compiled manifold build.");
const result = spawnSync("node", ["./scripts/buildManifoldPlus.js"], {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
