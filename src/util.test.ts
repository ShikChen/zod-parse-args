import { test, expect, vi } from "vitest";
import { assert, assertNever, repr } from "./util.ts";

test("assert", () => {
  expect(assert(1 === 1, "1 !== 1")).toBeUndefined();
  expect(() => assert(false, "test")).toThrow("test");
  expect(() => assertNever(0 as never)).toThrow();
});

test("repr", () => {
  expect(repr("hello")).toBe('"hello"');
  expect(repr(42)).toBe("42");
  expect(repr(42n)).toBe("42");
  expect(repr(null)).toBe("null");
  expect(repr(undefined)).toBe("undefined");
  expect(repr(NaN)).toBe("NaN");
  expect(repr(/^foo/)).toBe("/^foo/");

  expect("rawJSON" in JSON).toBe(true);
  expect(repr({ x: 9007199254740992n })).toBe('{"x":9007199254740992}');
  expect(repr({ x: Infinity })).toBe('{"x":"Infinity"}');
  expect(repr({ x: /^foo/ })).toBe('{"x":"/^foo/"}');
  expect(repr(new Map([["x", 42n]]))).toBe('{"x":42}');
  expect(repr([1, 2])).toBe("[1,2]");
  expect(repr(new Set([1, 2]))).toBe("[1,2]");

  const cyc = {} as any;
  cyc.self = cyc;
  expect(repr(cyc)).toBeTypeOf("string");

  using _rawJSON = vi.spyOn(JSON, "rawJSON" as any, "get");
  expect(repr({ x: 42n })).toBe('{"x":42}');
  expect(repr({ x: 9007199254740992n })).toBe('{"x":"9007199254740992"}');
});
