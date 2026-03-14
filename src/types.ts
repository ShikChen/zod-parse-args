import type * as z from "zod/v4/core";

// {{{ Public Types
/** Discriminated union returned by {@link safeParseArgs} and {@link safeParseArgsAsync}. */
export type ParseResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "help"; help: string }
  | { kind: "version"; version: string }
  | { kind: "schema-error"; error: string }
  | { kind: "parse-error"; error: string; help: string };

export interface ParseArgsOptions {
  /** Program name shown in help text. */
  name?: string;

  /** Version string. Enables `--version` when set. */
  version?: string;

  /** Arguments to parse. Defaults to `process.argv.slice(2)`. */
  args?: readonly string[];

  /** Environment variables for `env` fallbacks. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;

  /** Maximum line width for help text. Defaults to 80. */
  maxWidth?: number;
}

export type RootSchema = z.$ZodObject | z.$ZodDiscriminatedUnion;
// }}}

// {{{ Internal Types
export type Env = Exclude<ParseArgsOptions["env"], undefined>;

export interface InnerType {
  schema: z.$ZodType;
  optional: boolean;
  defaultValue: unknown;
}

export interface FieldMeta {
  long: string | null;
  short: string | null;
  positional: boolean;
  metavar: string | string[] | null;
  env: string | null;
  description: string | null;
}

export type FieldValueSpec =
  | { kind: "bool" }
  | { kind: "str" }
  | { kind: "tuple"; size: number }
  | { kind: "array" };

export interface FieldSpec {
  long: string;
  short: string | null;
  metavar: string[];
  env: string | null;
  description: string | null;
  target: string;
  value: FieldValueSpec;
  optional: boolean;
  defaultValue: unknown;
}

export type FieldMap = Map<string, FieldSpec>;

export interface SubcommandSpec {
  key: string | null; // null for root-level DU
  discriminator: string;
  variants: {
    values: string[];
    spec: CommandSpec;
  }[];
  optional: boolean;
  metavar: string;
}

export interface CommandSpec {
  options: FieldMap;
  positionals: FieldSpec[];
  subcommand: SubcommandSpec | null;
  description: string | null;
  version: string | null; // --version
  parent: CommandSpec | null;
}

export type Token =
  | {
      kind: "option";
      field: FieldSpec;
      value: string | string[];
      label: string;
    }
  | {
      kind: "positional";
      field: FieldSpec;
      value: string | string[];
    }
  | {
      kind: "subcommand";
      subcommand: SubcommandSpec;
      command: CommandSpec;
      value: string;
    };

export interface InputRecord {
  [key: string]: string | string[] | InputRecord;
}

export interface BoundInput {
  input: InputRecord;
  specs: CommandSpec[];
}

export type RawParseIssue = z.$ZodRawIssue<z.$ZodIssueCustom>;
// }}}
