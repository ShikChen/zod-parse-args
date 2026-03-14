import { assertType, test } from "vitest";
import type { ParseArgsOptions } from "./index.ts";

test("parse args options accepts readonly args", () => {
  assertType<ParseArgsOptions>({ args: ["--help"] as const });
});
