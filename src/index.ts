import * as z from "zod/v4/core";
import { buildCoercedSchema } from "./coerce";
import { compileSchema } from "./compile";
import { renderHelp, renderZodError } from "./render";
import { tokenize } from "./tokenize";
import { bindArgs } from "./bind";
import { HelpRequested, ParseError, SchemaError, VersionRequested } from "./errors";
import type { ParseArgsOptions, ParseResult, RootSchema } from "./types";
export type { ParseArgsOptions, ParseResult, RootSchema } from "./types";

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

export function safeParseArgs<T extends RootSchema>(
  schema: T,
  opts?: ParseArgsOptions,
): ParseResult<z.output<T>> {
  return safeParseArgsImpl(schema, opts ?? {}, z.safeParse);
}

export function parseArgs<T extends RootSchema>(schema: T, opts?: ParseArgsOptions): z.output<T> {
  return handleResult(safeParseArgs(schema, opts));
}

export async function safeParseArgsAsync<T extends RootSchema>(
  schema: T,
  opts?: ParseArgsOptions,
): Promise<ParseResult<z.output<T>>> {
  return safeParseArgsImpl(schema, opts ?? {}, z.safeParseAsync);
}

export async function parseArgsAsync<T extends RootSchema>(
  schema: T,
  opts?: ParseArgsOptions,
): Promise<z.output<T>> {
  return handleResult(await safeParseArgsAsync(schema, opts));
}
