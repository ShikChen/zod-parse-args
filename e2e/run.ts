import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectRoot = join(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "zod-parse-args-e2e-"));

try {
  // Pack the package into the temp dir
  execFileSync("npm", ["pack", "--pack-destination", dir], {
    cwd: projectRoot,
    stdio: "ignore",
  });
  const tarballPath = join(dir, readdirSync(dir).find((f) => f.endsWith(".tgz"))!);

  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));

  execFileSync("npm", ["install", "--no-audit", "--no-fund", "zod", "typescript", tarballPath], {
    cwd: dir,
    stdio: "inherit",
  });

  // Copy test fixtures
  cpSync(join(projectRoot, "e2e", "greet.ts"), join(dir, "greet.ts"));

  // Type check
  execFileSync("npx", ["tsc", "--noEmit", "--strict", "--module", "node16", "greet.ts"], {
    cwd: dir,
    stdio: "inherit",
  });

  // Runtime: greet --name World --times 3 --loud
  const stdout = execFileSync("node", ["greet.ts", "--name", "World", "--times", "3", "--loud"], {
    cwd: dir,
    encoding: "utf-8",
  });
  assert.equal(stdout, "HELLO, WORLD!\nHELLO, WORLD!\nHELLO, WORLD!\n");

  // Runtime: greet --name World (defaults)
  const stdout2 = execFileSync("node", ["greet.ts", "--name", "World"], {
    cwd: dir,
    encoding: "utf-8",
  });
  assert.equal(stdout2, "Hello, World!\n");

  console.log("All e2e tests passed.");
} finally {
  rmSync(dir, { recursive: true });
}
