import * as z from "zod/v4/core";
import {
  allDistinctByString,
  assert,
  getDef,
  getEnumMap,
  isDUDef,
  preprocess,
  repr,
  unwrapSchema,
} from "./util.ts";
import { SchemaError } from "./errors.ts";
import type { RawParseIssue } from "./types.ts";

function parseValueIssue(expected: string, input: unknown): RawParseIssue {
  return {
    code: "custom",
    message: `Expected ${expected}, got ${JSON.stringify(input)}`,
    input,
  };
}

function addIssue(ctx: z.ParsePayload, issue: RawParseIssue): typeof z.NEVER {
  ctx.issues.push(issue);
  return z.NEVER;
}

function parseNumber(input: string, ctx: z.ParsePayload): number {
  const num = Number(input);
  if (input.trim() === "" || Number.isNaN(num)) {
    return addIssue(ctx, parseValueIssue("number", input));
  }
  return num;
}

function parseBigInt(input: string, ctx: z.ParsePayload): bigint {
  if (input.trim() === "") {
    return addIssue(ctx, parseValueIssue("bigint", input));
  }
  try {
    return BigInt(input);
  } catch {
    return addIssue(ctx, parseValueIssue("bigint", input));
  }
}

function parseDate(input: string, ctx: z.ParsePayload): Date {
  const timestamp = Date.parse(input);
  if (Number.isNaN(timestamp)) {
    return addIssue(ctx, parseValueIssue("date", input));
  }
  return new Date(timestamp);
}

// Follows z.stringbool(): https://zod.dev/api#stringbool
const TRUE_STRINGS = new Set(["true", "1", "yes", "on", "y", "enabled"]);
const FALSE_STRINGS = new Set(["false", "0", "no", "off", "n", "disabled"]);
function parseBoolean(input: string, ctx: z.ParsePayload): boolean {
  const s = input.toLowerCase();
  if (TRUE_STRINGS.has(s)) {
    return true;
  } else if (FALSE_STRINGS.has(s)) {
    return false;
  } else {
    return addIssue(ctx, parseValueIssue("boolean", input));
  }
}

function fromString(
  fn: (input: string, ctx: z.ParsePayload) => unknown,
  schema: z.$ZodType,
): z.$ZodType {
  return preprocess((input, ctx) => (typeof input === "string" ? fn(input, ctx) : input), schema);
}

function withImplicitDefault<T extends z.$ZodType>(
  schema: T,
  defaultValue: z.input<T>,
): z.$ZodType {
  // Not using $ZodPrefault because it sets optin="optional", which prevents
  // $ZodOptional from short-circuiting on undefined input. Wrapping in
  // Pipe(Transform, schema) hides optin from Optional.
  return preprocess((input) => (input === undefined ? defaultValue : input), schema);
}

function coerceEnum(schema: z.$ZodEnum): z.$ZodType {
  const map = getEnumMap(schema._zod.def);
  const enumNames = Array.from(map.keys())
    .map((x) => repr(x))
    .join("|");

  const allValues = Array.from(map.values());
  const hasConflict =
    allValues.some((val) => typeof val === "string" && map.has(val)) ||
    !allDistinctByString(allValues);
  if (!hasConflict) {
    allValues.forEach((x) => map.set(String(x), x));
  }

  return fromString((input, ctx) => {
    const val = map.get(input);
    if (val === undefined) {
      return addIssue(ctx, parseValueIssue(`one of ${enumNames}`, input));
    }
    return val;
  }, schema);
}

function coerceLiteral(schema: z.$ZodLiteral): z.$ZodType {
  const def = schema._zod.def;
  if (!allDistinctByString(def.values)) {
    throw new SchemaError("Cannot coerce literal with conflicting string representations");
  }
  const map = new Map<string, z.input<typeof schema>>();
  def.values.forEach((val) => map.set(String(val), val));
  const literalValues = def.values.map((x) => repr(x)).join("|");
  return fromString((input, ctx) => {
    if (!map.has(input)) {
      return addIssue(ctx, parseValueIssue(`one of ${literalValues}`, input));
    }
    return map.get(input);
  }, schema);
}

function splitKeyValueEntries<T>(
  input: unknown,
  ctx: z.ParsePayload,
  fromEntriesFn: (entries: [string, string][]) => T,
): T {
  assert(Array.isArray(input), "Expected array input for map/record schema");
  const entries: [string, string][] = [];
  for (const item of input) {
    assert(typeof item === "string", "Expected string items for map/record schema");
    const eq = item.indexOf("=");
    if (eq === -1) {
      return addIssue(ctx, parseValueIssue("key=value pair", item));
    }
    const key = item.slice(0, eq);
    const val = item.slice(eq + 1);
    entries.push([key, val]);
  }
  return fromEntriesFn(entries);
}

function coerceMap(schema: z.$ZodMap): z.$ZodType {
  const def = schema._zod.def;
  return withImplicitDefault(
    preprocess(
      (input, ctx) => splitKeyValueEntries(input, ctx, (x) => new Map(x)),
      z.util.clone(schema, {
        ...def,
        keyType: buildCoercedSchema(def.keyType),
        valueType: buildCoercedSchema(def.valueType),
      }),
    ),
    [],
  );
}

function coerceRecord(schema: z.$ZodRecord): z.$ZodType {
  const def = schema._zod.def;
  return withImplicitDefault(
    preprocess(
      (input, ctx) => splitKeyValueEntries(input, ctx, Object.fromEntries),
      z.util.clone(schema, {
        ...def,
        // Although $ZodRecord has built-in number coercion for keys, we still
        // build coerced schemas for them to have consistent parsing behavior
        // and error messages.
        keyType: buildCoercedSchema(def.keyType),
        valueType: buildCoercedSchema(def.valueType),
      }),
    ),
    [],
  );
}

export function buildCoercedSchema<T extends z.$ZodType>(schema: T): z.$ZodType<z.output<T>>;

export function buildCoercedSchema(schema: z.$ZodType): z.$ZodType {
  const def = getDef(schema);

  switch (def.type) {
    // Passthrough types
    case "string":
    case "template_literal":
    case "any":
    case "unknown":
    case "custom":
    case "transform":
      return schema;

    // Primitive types
    case "number":
      return fromString(parseNumber, schema);
    case "bigint":
      return fromString(parseBigInt, schema);
    case "date":
      return fromString(parseDate, schema);
    case "boolean":
      return fromString(parseBoolean, withImplicitDefault(schema, false));

    // Wrapper types
    case "optional":
    case "nonoptional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "success":
      return z.util.clone(
        schema as
          | z.$ZodOptional
          | z.$ZodNonOptional
          | z.$ZodNullable
          | z.$ZodDefault
          | z.$ZodPrefault
          | z.$ZodCatch
          | z.$ZodReadonly
          | z.$ZodSuccess,
        {
          ...def,
          innerType: buildCoercedSchema(def.innerType),
        },
      );
    case "pipe":
      return z.util.clone(schema as z.$ZodPipe, {
        ...def,
        in: buildCoercedSchema(def.in),
      });

    // Container types
    case "enum":
      return coerceEnum(schema as z.$ZodEnum);
    case "literal":
      return coerceLiteral(schema as z.$ZodLiteral);
    case "tuple":
      return z.util.clone(schema as z.$ZodTuple, {
        ...def,
        items: def.items.map((item) => buildCoercedSchema(item)),
      });
    case "array":
      return withImplicitDefault(
        z.util.clone(schema as z.$ZodArray, {
          ...def,
          element: buildCoercedSchema(def.element),
        }),
        [],
      );
    case "set":
      return withImplicitDefault(
        preprocess(
          (input) => {
            assert(Array.isArray(input), "Expected array input for set schema");
            return new Set(input);
          },
          z.util.clone(schema as z.$ZodSet, {
            ...def,
            valueType: buildCoercedSchema(def.valueType),
          }),
        ),
        [],
      );
    case "map":
      return coerceMap(schema as z.$ZodMap);
    case "record":
      return coerceRecord(schema as z.$ZodRecord);
    case "object":
      return z.util.clone(schema as z.$ZodObject, {
        ...def,
        shape: Object.fromEntries(
          Object.entries(def.shape).map(([key, val]) => [key, buildCoercedSchema(val)]),
        ),
      });
    case "union":
      if (isDUDef(def)) {
        // Skip discriminator as coercing it would break Zod's DU propValues
        // matching, and compileSubcommand() already ensures it's a string
        // literal which doesn't need coercion.
        return z.util.clone(schema as z.$ZodDiscriminatedUnion, {
          ...def,
          options: def.options.map((opt) => {
            const optDef = getDef(opt);
            if (optDef.type !== "object") {
              throw new SchemaError(`Unsupported ${optDef.type} schema in discriminated union`);
            }
            return z.util.clone(opt as z.$ZodObject, {
              ...optDef,
              shape: Object.fromEntries(
                Object.entries(optDef.shape).map(([key, val]) => [
                  key,
                  key === def.discriminator ? val : buildCoercedSchema(val),
                ]),
              ),
            });
          }),
        });
      }
      return z.util.clone(schema as z.$ZodUnion, {
        ...def,
        options: def.options.map((opt) => buildCoercedSchema(opt)),
      });
    case "intersection":
      // If the coerced outputs of left/right diverge, Zod may throw an
      // "Unmergable intersection" error.
      //
      // e.g. z.intersection(z.number(), z.string()): after coercion,
      // "42" produces 42 on the left and "42" on the right; Zod cannot
      // merge them.
      //
      // This is generally impossible to detect at compile/coercion
      // time without actually running the schema, so we let Zod throw.
      //
      // TODO: Check why Zod throws instead of adding an issue.
      return z.util.clone(schema as z.$ZodIntersection, {
        ...def,
        left: buildCoercedSchema(def.left),
        right: buildCoercedSchema(def.right),
      });

    default:
      throw new SchemaError(`Unsupported schema type ${repr(def.type)}`);
  }
}
