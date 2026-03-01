import { test, expect } from "vitest";
import { add } from "./index";

test("add", () => {
  expect(add(1, 2)).toBe(3);
});
