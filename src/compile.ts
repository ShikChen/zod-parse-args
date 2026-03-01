import * as z from "zod/v4/core";
import {
  assert,
  camelToKebab,
  getDef,
  getEnumMap,
  hasImplicitDefault,
  isDUDef,
  isStringArray,
  repr,
  unwrapSchema,
} from "./util";
import { SchemaError } from "./errors";
import type {
  CommandSpec,
  FieldMap,
  FieldMeta,
  FieldSpec,
  FieldValueSpec,
  SubcommandSpec,
} from "./types";

function validateOptionName(name: string): void {
  if (name === "") {
    throw new SchemaError("Option name cannot be empty");
  }
  if (name.startsWith("-")) {
    throw new SchemaError("Option name cannot start with hyphen");
  }
  if (/[=\s]/.test(name)) {
    throw new SchemaError("Option name cannot contain spaces or equals");
  }
}

function getFieldMeta(schema: z.$ZodType): FieldMeta {
  const { long, short, positional, metavar, env, description } = z.globalRegistry.get(schema) ?? {};
  const stringOrNull = (x: unknown) => (typeof x === "string" ? x : null);
  const meta: FieldMeta = {
    long: stringOrNull(long),
    short: stringOrNull(short),
    positional: positional === true,
    metavar: stringOrNull(metavar),
    env: stringOrNull(env),
    description: stringOrNull(description),
  };
  if (meta.positional && (meta.long !== null || meta.short !== null)) {
    throw new SchemaError("Field cannot be both positional and an option");
  }
  if (meta.long !== null) {
    validateOptionName(meta.long);
  }
  if (meta.short !== null) {
    validateOptionName(meta.short);
    if (meta.short.length !== 1) {
      throw new SchemaError("Short option must be a single character");
    }
  }
  return meta;
}

function assertNoOptionMeta(
  schema: z.$ZodType,
  context: string,
  allowed: (keyof FieldMeta)[] = [],
): FieldMeta {
  const meta = getFieldMeta(schema);
  if (!allowed.includes("positional") && meta.positional) {
    throw new SchemaError(`${context} cannot be positional`);
  }
  for (const prop of ["long", "short", "env", "metavar"] as const) {
    if (allowed.includes(prop)) continue;
    if (meta[prop] !== null) {
      throw new SchemaError(`Unsupported metadata on ${context}: ${prop}=${meta[prop]}`);
    }
  }
  return meta;
}

function checkScalar(schema: z.$ZodType): { isScalar: true } | { isScalar: false; type: string } {
  schema = unwrapSchema(schema).schema;
  const def = getDef(schema);
  switch (def.type) {
    case "boolean":
      // Boolean is scalar here: as a container element it consumes one string value.
      return { isScalar: true };
    case "string":
    case "template_literal":
    case "any":
    case "unknown":
    case "custom":
    case "transform":
    case "number":
    case "bigint":
    case "date":
    case "literal":
    case "enum":
      return { isScalar: true };
    case "union":
      for (const opt of def.options) {
        const res = checkScalar(opt);
        if (!res.isScalar) return res;
      }
      return { isScalar: true };
    case "intersection":
      const leftRes = checkScalar(def.left);
      if (!leftRes.isScalar) return leftRes;
      return checkScalar(def.right);
    default:
      return { isScalar: false, type: def.type };
  }
}

function assertScalar(schema: z.$ZodType, parent: string): void {
  const check = checkScalar(schema);
  if (!check.isScalar) {
    throw new SchemaError(`Unsupported non-scalar field type ${check.type} in ${parent}`);
  }
}

function resolveConsistentArity(
  values: FieldValueSpec[],
  parent: "union" | "intersection",
): FieldValueSpec {
  assert(values.length > 0, `Unexpected empty ${parent}`);
  let result = values[0];
  for (const v of values) {
    if (v.kind === result.kind) {
      if (v.kind === "tuple" && result.kind === "tuple" && v.size !== result.size) {
        throw new SchemaError(`Inconsistent tuple sizes in ${parent}`);
      }
      continue;
    }
    if (v.kind === "bool" && result.kind === "str") {
      // already promoted
      continue;
    }
    if (v.kind === "str" && result.kind === "bool") {
      result = v;
      continue;
    }
    throw new SchemaError(`Inconsistent field value types in ${parent}`);
  }
  return result;
}

function buildFieldValue(schema: z.$ZodType): FieldSpec["value"] {
  const def = getDef(schema);
  switch (def.type) {
    // bool
    case "boolean":
      return { kind: "bool" };

    // str
    case "string":
    case "template_literal":
    case "any":
    case "unknown":
    case "custom":
    case "transform":
    case "number":
    case "bigint":
    case "date":
    case "literal":
    case "enum":
      return { kind: "str" };

    // array
    case "array":
      assertScalar(def.element, def.type);
      return { kind: "array" };
    case "set":
      assertScalar(def.valueType, def.type);
      return { kind: "array" };
    case "map":
    case "record":
      assertScalar(def.keyType, def.type);
      assertScalar(def.valueType, def.type);
      return { kind: "array" };

    // tuple
    case "tuple":
      if (def.rest !== null) {
        throw new SchemaError("Unsupported rest element in tuple schema");
      }
      for (const item of def.items) assertScalar(item, "tuple");
      return { kind: "tuple", size: def.items.length };

    // union/intersection
    case "union":
      if (isDUDef(def)) {
        throw new SchemaError("Unsupported discriminated union nested inside a field type");
      }
      const values = def.options.map((o) => buildFieldValue(unwrapSchema(o).schema));
      return resolveConsistentArity(values, def.type);
    case "intersection":
      const left = buildFieldValue(unwrapSchema(def.left).schema);
      const right = buildFieldValue(unwrapSchema(def.right).schema);
      return resolveConsistentArity([left, right], def.type);

    default:
      throw new SchemaError(`Unsupported field type ${repr(def.type)}`);
  }
}

function deriveMetavar(schema: z.$ZodType): string {
  const def = getDef(schema);
  switch (def.type) {
    // primitive
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "date":
      return def.type;

    // enum-like
    case "literal":
      return def.values.map((x) => String(x)).join("|");
    case "enum":
      return Array.from(getEnumMap(def).keys()).join("|");
    case "union":
      return def.options.map((x) => deriveMetavar(x)).join("|");

    // container
    case "tuple":
      return def.items.map((x) => deriveMetavar(x)).join(" ");
    case "array":
      return deriveMetavar(def.element);
    case "set":
      return deriveMetavar(def.valueType);
    case "record":
    case "map":
      return `${deriveMetavar(def.keyType)}=${deriveMetavar(def.valueType)}`;

    // wrappers
    case "optional":
    case "default":
    case "prefault":
    case "nonoptional":
    case "catch":
    case "nullable":
    case "readonly":
    case "success":
      return deriveMetavar(def.innerType);

    case "pipe":
      const outVar = deriveMetavar(def.out);
      if (outVar !== "value") return outVar;
      return deriveMetavar(def.in);

    default:
      return "value";
  }
}

function addOption(options: FieldMap, field: FieldSpec): void {
  function doSet(key: string) {
    if (options.has(key)) {
      throw new SchemaError(`Conflicting option: ${key}`);
    }
    options.set(key, field);
  }
  doSet(`--${field.long}`);
  if (field.value.kind === "bool") doSet(`--no-${field.long}`);
  if (field.short !== null) {
    doSet(`-${field.short}`);
  }
}

function assignParent(sub: SubcommandSpec, parent: CommandSpec): void {
  for (const variant of sub.variants) {
    variant.spec.parent = parent;
  }
}

function compileSubcommand(
  key: string | null,
  schema: z.$ZodDiscriminatedUnion,
  optional: boolean,
  metavar: string,
): SubcommandSpec {
  const def = schema._zod.def;
  const variants = [];
  for (const variant of def.options) {
    assertNoOptionMeta(variant, "discriminated union variant");
    const variantDef = getDef(variant);
    if (variantDef.type !== "object") {
      throw new SchemaError("Unsupported non-object variant in discriminated union");
    }

    const discField = variantDef.shape[def.discriminator];
    if (discField === undefined) {
      throw new SchemaError(`Missing discriminator field ${def.discriminator} in variant`);
    }
    assertNoOptionMeta(discField, "discriminator field");

    const discDef = getDef(discField);
    const values = (() => {
      if (discDef.type === "literal") {
        if (!isStringArray(discDef.values)) {
          throw new SchemaError("Unsupported non-string discriminator value");
        }
        return discDef.values;
      } else if (discDef.type === "enum") {
        const map = getEnumMap(discDef);
        return Array.from(map.keys());
      }
      throw new SchemaError("Unsupported non-literal discriminator field");
    })();

    const spec = compileSchema(variant);
    const discKeys = Array.from(spec.options.entries())
      .filter(([_, o]) => o.target === def.discriminator)
      .map(([k]) => k);
    assert(discKeys.length > 0, "Discriminator field not found in compiled variant spec");
    discKeys.forEach((k) => spec.options.delete(k));

    variants.push({ values, spec });
  }
  return { key, discriminator: def.discriminator, variants, optional, metavar };
}

export function compileSchema(schema: z.$ZodType): CommandSpec {
  const inner = unwrapSchema(schema);
  const def = getDef(inner.schema);
  if (def.type === "object") {
    const options: FieldMap = new Map();
    const positionals: FieldSpec[] = [];
    let positionalArray: FieldSpec | null = null;
    let subcommand: CommandSpec["subcommand"] = null;
    for (const [key, fieldSchema] of Object.entries(def.shape)) {
      const inner = unwrapSchema(fieldSchema);
      if (isDUDef(getDef(inner.schema))) {
        if (subcommand !== null) {
          throw new SchemaError("Unsupported multiple discriminated unions in the same level");
        }
        const meta = assertNoOptionMeta(fieldSchema, "discriminated union", ["metavar"]);
        subcommand = compileSubcommand(
          key,
          inner.schema as z.$ZodDiscriminatedUnion,
          inner.optional,
          meta.metavar ?? "COMMAND",
        );
      } else {
        const meta = getFieldMeta(fieldSchema);
        const value = buildFieldValue(inner.schema);
        const metavar = (() => {
          if (meta.metavar !== null) return meta.metavar;
          if (meta.positional) return key;
          return deriveMetavar(fieldSchema);
        })();
        const fieldSpec = {
          long: meta.long ?? camelToKebab(key),
          short: meta.short,
          metavar: metavar,
          env: meta.env,
          description: meta.description,
          target: key,
          value,
          optional: inner.optional || hasImplicitDefault(inner.schema),
          defaultValue: inner.defaultValue,
        };
        if (meta.env !== null && value.kind === "tuple") {
          throw new SchemaError("Tuple fields cannot be set from environment");
        }
        if (meta.positional) {
          if (value.kind === "array") {
            if (positionalArray !== null) {
              throw new SchemaError("Unsupported multiple array positionals in the same level");
            }
            positionalArray = fieldSpec;
          } else {
            positionals.push(fieldSpec);
          }
        } else {
          addOption(options, fieldSpec);
        }
      }
    }
    if (positionalArray !== null) positionals.push(positionalArray);
    const spec = {
      options,
      positionals,
      subcommand,
      description: getFieldMeta(schema).description,
      version: null,
      parent: null,
    };
    if (subcommand !== null) {
      if (positionalArray !== null) {
        throw new SchemaError("Unsupported array positional with sibling subcommand");
      }
      if (!subcommand.optional && positionals.some((x) => x.optional)) {
        throw new SchemaError("Unsupported required subcommand with optional positionals");
      }
      assignParent(subcommand, spec);
    }
    return spec;
  } else if (isDUDef(def)) {
    const { metavar, description } = assertNoOptionMeta(schema, "discriminated union", ["metavar"]);
    const subcommand = compileSubcommand(
      null,
      inner.schema as z.$ZodDiscriminatedUnion,
      inner.optional,
      metavar ?? "COMMAND",
    );
    const spec = {
      options: new Map(),
      positionals: [],
      subcommand,
      description,
      version: null,
      parent: null,
    };
    assignParent(subcommand, spec);
    return spec;
  } else {
    throw new SchemaError(`Unsupported root schema type ${repr(def.type)}`);
  }
}
