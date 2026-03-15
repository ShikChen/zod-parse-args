import * as z from "zod/v4/core";
import { SchemaError } from "./errors.ts";
import type { FieldMeta, FieldValueSpec } from "./types.ts";
import { assertNever, camelToKebab, getDef, isStringArray, unwrapSchema } from "./util.ts";

export function getMetavar(schema: z.$ZodType): string | string[] | null {
  const { metavar } = z.globalRegistry.get(schema) ?? {};
  if (typeof metavar === "string") return metavar;
  if (isStringArray(metavar)) return [...metavar];
  return null;
}

function getStringMetavar(schema: z.$ZodType): string | null {
  const metavar = getMetavar(schema);
  if (Array.isArray(metavar)) {
    throw new SchemaError("Array metavar is only supported for tuple fields");
  }
  return typeof metavar === "string" ? metavar : null;
}

function isKeyValueSchema(schema: z.$ZodType): boolean {
  const def = getDef(schema);
  switch (def.type) {
    case "record":
    case "map":
      return true;
    case "union":
      return def.options.every((x) => isKeyValueSchema(unwrapSchema(x).schema));
    case "intersection":
      return (
        isKeyValueSchema(unwrapSchema(def.left).schema) &&
        isKeyValueSchema(unwrapSchema(def.right).schema)
      );
    case "optional":
    case "default":
    case "prefault":
    case "nonoptional":
    case "catch":
    case "nullable":
    case "readonly":
    case "success":
      return isKeyValueSchema(def.innerType);
    case "pipe":
      return isKeyValueSchema(def.in);
    default:
      return false;
  }
}

export function deriveMetavar(
  key: string,
  schema: z.$ZodType,
  value: FieldValueSpec,
  meta: FieldMeta,
): string[] {
  const { positional, metavar } = meta;
  if (metavar !== null) {
    if (Array.isArray(metavar)) {
      if (value.kind !== "tuple") {
        throw new SchemaError("Array metavar is only supported for tuple fields");
      }
      if (metavar.length !== value.size) {
        throw new SchemaError(
          `Tuple metavar must have exactly ${value.size} items, got ${metavar.length}`,
        );
      }
      return [...metavar];
    }
    return value.kind === "tuple" ? Array(value.size).fill(metavar) : [metavar];
  }

  const def = getDef(schema);
  const label = camelToKebab(key);
  const scalarFallback = positional ? label : "value";

  switch (value.kind) {
    case "tuple":
      if (def.type === "tuple") {
        const items = def.items.map((x) => getStringMetavar(x));
        if (items.every((item) => item !== null)) return items;
        if (!positional) return items.map((item) => item ?? "value");
      }
      return positional
        ? Array.from({ length: value.size }, (_, i) => `${label}-${i + 1}`)
        : Array(value.size).fill(scalarFallback);
    case "array":
      switch (def.type) {
        case "array":
          return [getStringMetavar(def.element) ?? scalarFallback];
        case "set":
          return [getStringMetavar(def.valueType) ?? scalarFallback];
        case "map":
        case "record":
          const keyMetavar = getStringMetavar(def.keyType) ?? "key";
          const valueMetavar = getStringMetavar(def.valueType) ?? "value";
          return [`${keyMetavar}=${valueMetavar}`];
        default:
          return isKeyValueSchema(schema) ? ["key=value"] : [scalarFallback];
      }
    case "bool":
    case "str":
      return [scalarFallback];
    default:
      return assertNever(value);
  }
}

export function normalizeSubcommandMetavar(metavar: FieldMeta["metavar"]): string {
  if (metavar === null) return "command";
  if (typeof metavar === "string") return metavar;
  throw new SchemaError("Subcommand metavar must be a string");
}
