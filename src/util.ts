import * as z from "zod/v4/core";
import { AssertionError } from "./errors";
import type { CommandSpec, FieldSpec, InnerType } from "./types";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export function assertNever(value: never): never {
  throw new AssertionError(`Unexpected value: ${value}`);
}

// {{{ Zod Helpers
export function getDef(schema: z.$ZodType): z.$ZodTypes["_zod"]["def"] {
  // We can cast any schema to $ZodTypes and use the def property to
  // discriminate between these classes.
  // Ref: from https://zod.dev/packages/core#internals
  return (schema as z.$ZodTypes)._zod.def;
}

export function isDUDef(def: z.$ZodTypes["_zod"]["def"]): def is z.$ZodDiscriminatedUnionDef {
  return def.type === "union" && "discriminator" in def;
}

export function unwrapSchema(schema: z.$ZodType): InnerType {
  const def = getDef(schema);
  switch (def.type) {
    case "optional":
      return { ...unwrapSchema(def.innerType), optional: true };
    case "default":
    case "prefault":
      return {
        ...unwrapSchema(def.innerType),
        optional: true,
        defaultValue: def.defaultValue,
      };
    case "nonoptional":
      return { ...unwrapSchema(def.innerType), optional: false };
    case "catch":
    case "nullable":
    case "readonly":
    case "success":
      return unwrapSchema(def.innerType);
    case "pipe":
      return unwrapSchema(def.in);
    default:
      return { schema, optional: false, defaultValue: undefined };
  }
}

function newTransform(fn: (input: unknown, ctx: z.ParsePayload) => unknown): z.$ZodTransform {
  return new z.$ZodTransform({ type: "transform", transform: fn });
}

function newPipe(input: z.$ZodType, output: z.$ZodType): z.$ZodPipe {
  return new z.$ZodPipe({ type: "pipe", in: input, out: output });
}

export function preprocess(
  fn: (input: unknown, ctx: z.ParsePayload) => unknown,
  schema: z.$ZodType,
): z.$ZodType {
  return newPipe(newTransform(fn), schema);
}

export function getEnumMap(def: z.$ZodEnumDef): Map<string, z.util.EnumValue> {
  const map = new Map<string, z.util.EnumValue>();
  const numericValues = new Set<number>(
    Object.values(def.entries).filter((x): x is number => typeof x === "number"),
  );
  for (const [key, val] of Object.entries(def.entries)) {
    if (numericValues.has(Number(key))) continue;
    map.set(key, val);
  }
  return map;
}
const IMPLICIT_DEFAULT_TYPES = new Set<z.$ZodTypes["_zod"]["def"]["type"]>([
  "boolean",
  "array",
  "set",
  "map",
  "record",
]);
export function hasImplicitDefault(schema: z.$ZodType): boolean {
  return IMPLICIT_DEFAULT_TYPES.has(getDef(schema).type);
}
// }}}

export function* enumerateOptionFields(cmd: CommandSpec): Generator<FieldSpec> {
  const seen = new WeakSet<FieldSpec>();
  for (const field of cmd.options.values()) {
    if (seen.has(field)) continue;
    seen.add(field);
    yield field;
  }
}

export function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((x) => typeof x === "string");
}

export function camelToKebab(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

export function allDistinctByString(values: unknown[]): boolean {
  return new Set(values.map((x) => String(x))).size === values.length;
}

export function repr(input: unknown): string {
  if (
    // Show `42` instead of `42n` for bigint inputs to avoid confusion.
    typeof input === "bigint" ||
    // Show non JSON-serializable numbers like `NaN`, `Infinity` as-is.
    typeof input === "number" ||
    input === undefined ||
    input instanceof RegExp
  ) {
    return String(input);
  }
  // @ts-ignore
  let rawJSON = JSON.rawJSON as ((s: string) => unknown) | undefined;
  try {
    const s = JSON.stringify(input, (_, val) => {
      if (typeof val === "bigint") {
        if (rawJSON !== undefined) return rawJSON(String(val));
        if (Number.isSafeInteger(Number(val))) return Number(val);
        return String(val);
      }
      if (val === undefined || (typeof val === "number" && !isFinite(val))) {
        return String(val);
      }
      if (val instanceof Map) return Object.fromEntries(val);
      if (val instanceof Set) return Array.from(val);
      if (val instanceof RegExp) return String(val);
      return val;
    });
    return s ?? String(input);
  } catch {
    return String(input);
  }
}
