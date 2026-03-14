import { test, expect, vi } from "vitest";
import {
  parseArgs,
  safeParseArgs,
  parseArgsAsync,
  safeParseArgsAsync,
  type RootSchema,
  type ParseArgsOptions,
} from "./index.ts";
import * as z from "zod";
import * as zodMini from "zod/mini";

const obj = z.object.bind(z);
const lit = z.literal.bind(z);
const du = z.discriminatedUnion.bind(z);

const kvStoreSchema = du("cmd", [
  obj({
    cmd: lit("get"),
    key: z.string().describe("Key to look up"),
  }).describe("Get a value"),
  obj({
    cmd: lit("set"),
    key: z.string().describe("Key to update"),
    value: z.int().describe("Value to store"),
  }).describe("Set a value"),
]).describe("A simple key-value store");

function asArgs(args: string[] | ParseArgsOptions): ParseArgsOptions {
  return Array.isArray(args) ? { args } : args;
}

function expectOk<T extends RootSchema>(
  schema: T,
  args: string[] | ParseArgsOptions,
  data: z.infer<T>,
) {
  const res = safeParseArgs(schema, asArgs(args));
  expect(res).toEqual({ kind: "ok", data });
}

function expectHelp<T extends RootSchema>(
  schema: T,
  args: string[] | ParseArgsOptions,
  help: string,
) {
  const res = safeParseArgs(schema, asArgs(args));
  expect(res).toEqual({ kind: "help", help: expect.stringContaining(help) });
}

function expectVersion<T extends RootSchema>(
  schema: T,
  args: string[] | ParseArgsOptions,
  version: string,
) {
  const res = safeParseArgs(schema, asArgs(args));
  expect(res).toEqual({
    kind: "version",
    version: expect.stringContaining(version),
  });
}

function expectParseError<T extends RootSchema>(
  schema: T,
  args: string[] | ParseArgsOptions,
  error: string = "",
) {
  const res = safeParseArgs(schema, asArgs(args));
  expect(res).toEqual({
    kind: "parse-error",
    error: expect.stringContaining(error),
    help: expect.stringContaining("Usage:"),
  });
}

function expectSchemaError<T extends RootSchema>(
  schema: T,
  args: string[] | ParseArgsOptions = [],
  error: string = "",
) {
  const res = safeParseArgs(schema, asArgs(args));
  expect(res).toEqual({
    kind: "schema-error",
    error: expect.stringContaining(error),
  });
}

test("scalar", () => {
  expectOk(obj({ name: z.string() }), ["--name", "Amy"], { name: "Amy" });
  expectOk(obj({ age: z.number() }), ["--age", "18"], { age: 18 });
  expectOk(obj({ age: z.bigint() }), ["--age", "12345678901234567890"], {
    age: 12345678901234567890n,
  });
  expectOk(obj({ due: z.date() }), ["--due", "2020-01-23"], {
    due: new Date("2020-01-23"),
  });

  expectOk(obj({ json: z.boolean() }), ["--json"], { json: true });
  expectOk(obj({ ssl: z.stringbool() }), ["--ssl", "true"], { ssl: true });

  expectOk(obj({ env: z.enum(["dev", "prod"]) }), ["--env", "prod"], {
    env: "prod",
  });
  enum Dir {
    L = 0,
    R = 1,
  }
  expectOk(obj({ color: z.enum(Dir) }), ["--color", "L"], { color: Dir.L });
  expectOk(obj({ color: z.enum(Dir) }), ["--color", "1"], { color: Dir.R });
  expectOk(obj({ env: lit(["dev", "prod"]) }), ["--env", "dev"], {
    env: "dev",
  });
  expectOk(
    obj({ size: z.templateLiteral([z.number(), z.enum(["KB", "MB", "GB"])]) }),
    ["--size", "10MB"],
    { size: "10MB" },
  );

  const portSchema = obj({ port: z.union([z.number(), lit("auto")]) });
  expectOk(portSchema, ["--port", "8080"], { port: 8080 });
  expectOk(portSchema, ["--port", "auto"], { port: "auto" });

  const absPath = z.string().startsWith("/");
  const txtFile = z.string().endsWith(".txt");
  const pathSchema = obj({ path: z.intersection(absPath, txtFile) });
  expectOk(pathSchema, ["--path", "/tmp/file.txt"], { path: "/tmp/file.txt" });
  expectParseError(pathSchema, ["--path", "tmp/file.txt"]);
  expectParseError(pathSchema, ["--path", "/tmp/file.jpg"]);
});

test("collection", () => {
  expectOk(obj({ tag: z.array(z.string()) }), ["--tag", "prod", "--tag", "ready"], {
    tag: ["prod", "ready"],
  });
  expectOk(obj({ tag: z.set(z.string()) }), ["--tag", "prod", "--tag", "ready"], {
    tag: new Set(["prod", "ready"]),
  });
  expectOk(
    obj({ tag: z.record(z.string(), z.string()) }),
    ["--tag", "env=prod", "--tag", "status=ready"],
    { tag: { env: "prod", status: "ready" } },
  );
  expectOk(
    obj({ tag: z.map(z.string(), z.string()) }),
    ["--tag", "env=prod", "--tag", "status=ready"],
    {
      tag: new Map([
        ["env", "prod"],
        ["status", "ready"],
      ]),
    },
  );
  expectOk(obj({ size: z.tuple([z.number(), z.number()]) }), ["--size", "640", "480"], {
    size: [640, 480],
  });
  expectOk(
    obj({
      map: z.map(
        z.union([z.number(), z.string()]),
        z.intersection(z.string().min(1), z.string().max(10)),
      ),
    }),
    ["--map", "1=one", "--map", "max=999"],
    {
      map: new Map<number | string, string>([
        [1, "one"],
        ["max", "999"],
      ]),
    },
  );
});

test("wrapper", () => {
  expectOk(obj({ user: z.string().optional() }), [], { user: undefined });
  expectParseError(obj({ user: z.string().optional().nonoptional() }), []);
  expectOk(obj({ user: z.string().default("root") }), [], { user: "root" });
  expectOk(obj({ user: z.string().nullable().default(null) }), [], {
    user: null,
  });
  expectOk(
    obj({
      filter: z
        .string()
        .transform((s) => new RegExp(s, "i"))
        .prefault("^error:"),
    }),
    [],
    { filter: /^error:/i },
  );
});

test("subcommand", () => {
  expectOk(kvStoreSchema, ["get", "--key", "cat"], { cmd: "get", key: "cat" });
  expectOk(kvStoreSchema, ["set", "--key", "cat", "--value", "42"], {
    cmd: "set",
    key: "cat",
    value: 42,
  });
  const root = obj({ debug: z.boolean(), action: kvStoreSchema });
  expectOk(root, ["--debug", "get", "--key", "cat"], {
    debug: true,
    action: { cmd: "get", key: "cat" },
  });
  expectParseError(root, ["get", "--key", "cat", "--debug"], "--debug");
});

test("meta", () => {
  expectOk(obj({ name: z.string().meta({ positional: true }) }), ["Amy"], {
    name: "Amy",
  });
  expectOk(obj({ tags: z.string().array().meta({ positional: true }) }), ["prod", "online"], {
    tags: ["prod", "online"],
  });
  expectOk(obj({ userName: z.string().meta({ long: "name" }) }), ["--name", "Amy"], {
    userName: "Amy",
  });
  expectOk(obj({ name: z.string().meta({ short: "n" }) }), ["-n", "Amy"], {
    name: "Amy",
  });
  const envSchema = obj({ name: z.string().meta({ env: "NAME" }) });
  expectOk(envSchema, { env: { NAME: "Amy" } }, { name: "Amy" });
  expectOk(envSchema, { args: ["--name", "Amy"], env: { NAME: "Bob" } }, { name: "Amy" });
  expectOk(obj({ json: z.boolean().meta({ env: "JSON" }) }), { env: { JSON: "" } }, { json: true });
});

test("tokenize", () => {
  expectOk(obj({ name: z.string() }), ["--name=Amy"], { name: "Amy" });
  expectOk(obj({ json: z.boolean() }), ["--json=1"], { json: true });
  const shortSchema = obj({
    force: z.boolean().meta({ short: "f" }),
    name: z.string().meta({ short: "n" }),
  });
  expectOk(shortSchema, ["-fnAmy"], { force: true, name: "Amy" });
  expectOk(shortSchema, ["-f=0", "-n=Amy"], { force: false, name: "Amy" });
  expectOk(
    obj({ size: z.tuple([z.number(), z.number()]).meta({ short: "s" }) }),
    ["-s", "640", "480"],
    { size: [640, 480] },
  );
  expectOk(
    obj({ size: z.tuple([z.number(), z.number()]).meta({ positional: true }) }),
    ["640", "480"],
    { size: [640, 480] },
  );
  expectOk(obj({ name: z.string().meta({ positional: true }) }), ["--", "Amy"], { name: "Amy" });
});

test("help", () => {
  function parse(schema: RootSchema, args: string[] = ["--help"]): string {
    const res = safeParseArgs(schema, { name: "test", version: "1.2.3", args });
    expect(res.kind).toBe("help");
    return res.kind === "help" ? res.help : "";
  }
  expectHelp(obj({ name: z.string() }), ["--help"], "--name <value>");
  expectHelp(
    obj({ size: z.tuple([z.number(), z.number()]) }),
    ["--help"],
    "--size <value> <value>",
  );
  expectHelp(
    obj({
      size: z.tuple([z.number(), z.number()]).meta({
        metavar: ["width", "height"],
      }),
    }),
    ["--help"],
    "--size <width> <height>",
  );
  expectHelp(
    obj({ sourcePath: z.string().meta({ positional: true }) }),
    ["--help"],
    "<source-path>",
  );
  expectHelp(
    obj({
      range: z.tuple([z.number(), z.number()]).optional().meta({ positional: true }),
    }),
    ["--help"],
    "[<range-1> <range-2>]",
  );
  expectHelp(
    obj({
      envVars: z.record(z.string(), z.string()).meta({ positional: true }),
    }),
    ["--help"],
    "[key=value]...",
  );
  expectHelp(obj({ env: z.record(z.string(), z.string()) }), ["--help"], "--env <key=value>");
  expectOk(obj({ help: z.boolean() }), ["--help"], { help: true });
  expect(parse(kvStoreSchema)).toMatchSnapshot();
  expect(parse(kvStoreSchema, ["get", "--help"])).toMatchSnapshot();
  expect(parse(kvStoreSchema, ["set", "--help"])).toMatchSnapshot();
});

test("version", () => {
  expectVersion(obj({ name: z.string() }), { args: ["--version"], version: "1.2.3" }, "1.2.3");
  expectParseError(obj({ name: z.string() }), ["--version"], "Unknown option: --version");
});

test("parseArgs", () => {
  const schema = obj({ name: z.string() });
  expect(parseArgs(schema, { args: ["--name", "Amy"] })).toEqual({
    name: "Amy",
  });

  function check(
    opts: string[] | ParseArgsOptions,
    log: string | null,
    error: string | null,
    code: number,
  ) {
    using exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    using errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => parseArgs(schema, asArgs(opts))).toThrow();
    if (log !== null) {
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(log));
    }
    if (error !== null) {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(error));
    }
    expect(exit).toHaveBeenCalledWith(code);
  }
  check(["--help"], "--name <value>", null, 0);
  check({ args: ["--version"], version: "1.2.3" }, "1.2.3", null, 0);
  check(["--name"], "Usage:", "--name: Missing value", 1);
});

test("async", async () => {
  const schema = obj({ name: z.string().refine(async () => true) });
  const args = await parseArgsAsync(schema, { args: ["--name", "Amy"] });
  expect(args).toEqual({ name: "Amy" });
  const res = await safeParseArgsAsync(schema, { args: ["--name", "Amy"] });
  expect(res).toEqual({ kind: "ok", data: { name: "Amy" } });
  expectSchemaError(
    schema,
    ["--name", "Amy"],
    "Async schemas are not supported in sync parsing functions",
  );
});

test("parse error", () => {
  const bad = expectParseError;
  bad(obj({ age: z.number() }), ["--age", "one"]);
  bad(obj({ age: z.number() }), ["--age", "18", "extra"]);
  bad(obj({ age: z.number() }), ["-a", "18"]);
  bad(obj({ age: z.number().meta({ short: "a" }) }), ["-a"]);
  bad(obj({ age: z.number().meta({ positional: true }) }), ["one"]);
  bad(obj({ age: z.bigint() }), ["--age", ""]);
  bad(obj({ age: z.bigint() }), ["--age", "3nm"]);
  bad(obj({ foo: z.tuple([z.int(), z.int()]) }), ["--foo=1"]);
  bad(obj({ foo: z.tuple([z.int(), z.int()]) }), ["--foo", "1"]);
  bad(obj({ foo: z.tuple([z.int(), z.int()]).meta({ short: "f" }) }), ["-f=1"]);
  bad(
    obj({
      debug: z.boolean().meta({ short: "d" }),
      foo: z.tuple([z.int(), z.int()]).meta({ short: "f" }),
    }),
    ["-fd", "1", "2"],
  );
  bad(obj({ json: z.boolean() }), ["--no-json=false"]);
  bad(obj({ json: z.boolean() }), ["--json=tbd"]);
  bad(obj({ at: z.date() }), ["--at", "not-a-date"]);
  bad(obj({ env: z.enum(["dev", "prod"]) }), ["--env", "staging"]);
  bad(obj({ env: z.literal(["dev", "prod"]) }), ["--env", "staging"]);
  bad(obj({ config: z.map(z.string(), z.string()) }), ["--config", "noequal"]);
  bad(kvStoreSchema, []);
  bad(kvStoreSchema, ["del"]);
  bad(obj({ name: z.string().meta({ env: "NAME" }) }), {
    env: { NAME: undefined },
  });
});

test("schema error", () => {
  const bad = expectSchemaError;
  bad(z.string() as any);
  bad(obj({ name: z.string().meta({ long: "--hyphen" }) }));
  bad(obj({ name: z.string().meta({ long: "sp ace" }) }));
  bad(obj({ name: z.string().meta({ long: "" }) }));
  bad(obj({ name: z.string().meta({ long: "user", positional: true }) }));
  bad(obj({ name: z.string().meta({ short: "na" }) }));
  bad(kvStoreSchema.meta({ positional: true }));
  bad(kvStoreSchema.meta({ long: "kv" }));
  bad(obj({ foo: z.string().array().array() }));
  bad(obj({ foo: z.union([z.string().array(), z.string()]) }));
  bad(obj({ foo: z.union([z.tuple([z.int()]), z.tuple([z.int(), z.int()])]) }));
  bad(obj({ foo: z.symbol() }));
  bad(obj({ foo: z.literal([1, "1"]) }));
  bad(obj({ foo: z.string(), bar: z.string().meta({ long: "foo" }) }));
  bad(obj({ foo: z.tuple([z.string(), z.string()]).meta({ env: "FOO" }) }));
  bad(obj({ foo: z.string().meta({ metavar: ["value"] }) }));
  bad(obj({ foo: z.tuple([z.int(), z.int()]).meta({ metavar: ["x"] }) }));
  bad(obj({ foo: z.tuple([z.int()], z.string()) }));
  bad(kvStoreSchema.meta({ metavar: ["command"] }));
  bad(obj({ kv1: kvStoreSchema, kv2: kvStoreSchema }));
  const posIntArray = z.int().array().meta({ positional: true });
  bad(obj({ a1: posIntArray, a2: posIntArray }));
  bad(obj({ arr: posIntArray, kv: kvStoreSchema }));
  const optPosInt = z.int().optional().meta({ positional: true });
  bad(obj({ opt: optPosInt, kv: kvStoreSchema }));
});

test("zod mini", () => {
  const z = zodMini;
  expectOk(z.object({ name: z.string() }), ["--name", "Amy"], { name: "Amy" });
  expectOk(z.object({ age: z.number() }), ["--age", "18"], { age: 18 });
  expectOk(z.object({ name: z.string().check(z.trim()) }), ["--name", "Amy "], { name: "Amy" });
});
