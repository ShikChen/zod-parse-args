import * as z from "zod/v4/core";
import { buildCoercedSchema } from "./coerce.ts";
import { compileSchema } from "./compile.ts";
import { renderHelp, renderZodError } from "./render.ts";
import { tokenize } from "./tokenize.ts";
import { bindArgs } from "./bind.ts";
import { HelpRequested, ParseError, SchemaError, VersionRequested } from "./errors.ts";
import type { ParseArgsOptions, ParseResult, RootSchema } from "./types.ts";
export type { ParseArgsOptions, ParseResult, RootSchema } from "./types.ts";

declare module "zod" {
  interface GlobalMeta {
    /** Treat this field as a positional argument instead of a named option. */
    positional?: boolean;

    /** Override the long option name (default: camelCase key converted to kebab-case). */
    long?: string;

    /** Single-character short alias (e.g. `"f"` for `-f`). */
    short?: string;

    /** Environment variable name to use as a fallback value. */
    env?: string;

    /** Placeholder name shown in help text (e.g. show `<SECONDS>` instead of `<number>`). */
    metavar?: string;
  }
}

function handleResult<T>(result: ParseResult<T>): T {
  switch (result.kind) {
    case "ok":
      return result.data;
    case "help":
      console.log(result.help);
      return process.exit(0);
    case "version":
      console.log(result.version);
      return process.exit(0);
    case "parse-error":
      console.error(result.error);
      console.log(result.help);
      return process.exit(1);
    case "schema-error":
      throw new Error(result.error);
  }
}

function safeParseArgsImpl<T extends RootSchema>(
  schema: T,
  opts: ParseArgsOptions,
  parse: typeof z.safeParse,
): ParseResult<z.output<T>>;

function safeParseArgsImpl<T extends RootSchema>(
  schema: T,
  opts: ParseArgsOptions,
  parse: typeof z.safeParseAsync,
): Promise<ParseResult<z.output<T>>>;

function safeParseArgsImpl(
  schema: RootSchema,
  opts: ParseArgsOptions,
  parse: typeof z.safeParse | typeof z.safeParseAsync,
) {
  try {
    const spec = compileSchema(schema);
    spec.version = opts.version ?? null;
    const args = opts.args ?? process.argv.slice(2);
    const tokens = tokenize(spec, args);
    const bound = bindArgs(spec, tokens, opts.env ?? process.env);
    const coercedSchema = buildCoercedSchema(schema);

    function mapResult(result: z.util.SafeParseResult<unknown>): ParseResult<unknown> {
      if (result.success) return { kind: "ok", data: result.data };
      return {
        kind: "parse-error",
        error: renderZodError(result.error, bound),
        help: renderHelp(bound.specs[bound.specs.length - 1], opts),
      };
    }

    const result = parse(coercedSchema, bound.input);
    return result instanceof Promise ? result.then((r) => mapResult(r)) : mapResult(result);
  } catch (e) {
    if (e instanceof HelpRequested) {
      return { kind: "help", help: renderHelp(e.spec, opts) };
    } else if (e instanceof VersionRequested) {
      return { kind: "version", version: e.version };
    } else if (e instanceof SchemaError) {
      return { kind: "schema-error", error: e.message };
    } else if (e instanceof z.$ZodAsyncError) {
      return {
        kind: "schema-error",
        error: "Async schemas are not supported in sync parsing functions",
      };
    } else if (e instanceof ParseError) {
      return {
        kind: "parse-error",
        error: e.message,
        help: renderHelp(e.spec, opts),
      };
    }
    throw e;
  }
}

/**
 * Parse CLI arguments against a Zod schema without exiting the process.
 *
 * Returns a discriminated union describing the outcome: parsed data,
 * help/version text, or an error with help text.
 *
 * @param schema - A `z.object()` or `z.discriminatedUnion()` schema defining the CLI interface.
 * @param opts - Options for program name, version, custom args, env, and help text width.
 * @returns A {@link ParseResult} indicating success or the kind of failure.
 */
export function safeParseArgs<T extends RootSchema>(
  schema: T,
  opts?: ParseArgsOptions,
): ParseResult<z.output<T>> {
  return safeParseArgsImpl(schema, opts ?? {}, z.safeParse);
}

/**
 * Parse CLI arguments against a Zod schema.
 *
 * On `--help` or `--version`, prints the corresponding output and exits with code 0.
 * On validation errors, prints the error and help text, then exits with code 1.
 *
 * @param schema - A `z.object()` or `z.discriminatedUnion()` schema defining the CLI interface.
 * @param opts - Options for program name, version, custom args, env, and help text width.
 * @returns The parsed and validated result, fully typed from the schema.
 */
export function parseArgs<T extends RootSchema>(schema: T, opts?: ParseArgsOptions): z.output<T> {
  return handleResult(safeParseArgs(schema, opts));
}

/**
 * Async version of {@link safeParseArgs}, for schemas with async refinements or transforms.
 *
 * @param schema - A `z.object()` or `z.discriminatedUnion()` schema defining the CLI interface.
 * @param opts - Options for program name, version, custom args, env, and help text width.
 * @returns A promise that resolves to a {@link ParseResult} indicating success or the kind of failure.
 */
export async function safeParseArgsAsync<T extends RootSchema>(
  schema: T,
  opts?: ParseArgsOptions,
): Promise<ParseResult<z.output<T>>> {
  return safeParseArgsImpl(schema, opts ?? {}, z.safeParseAsync);
}

/**
 * Async version of {@link parseArgs}, for schemas with async refinements or transforms.
 *
 * @param schema - A `z.object()` or `z.discriminatedUnion()` schema defining the CLI interface.
 * @param opts - Options for program name, version, custom args, env, and help text width.
 * @returns A promise that resolves to the parsed and validated result, fully typed from the schema.
 */
export async function parseArgsAsync<T extends RootSchema>(
  schema: T,
  opts?: ParseArgsOptions,
): Promise<z.output<T>> {
  return handleResult(await safeParseArgsAsync(schema, opts));
}
