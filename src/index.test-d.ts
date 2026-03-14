import * as z from "zod";
import { assertType, test } from "vitest";
import type { ParseArgsOptions } from "./index.ts";

test("parse args options accepts readonly args", () => {
  assertType<ParseArgsOptions>({ args: ["--help"] as const });
});

test("tuple fields accept readonly metavar arrays", () => {
  z.object({
    size: z.tuple([z.number(), z.number()]).meta({
      metavar: ["width", "height"] as const,
    }),
  });
});
