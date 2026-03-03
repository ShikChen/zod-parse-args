# zod-parse-args

CLI argument parsing with
[`util.parseArgs`](https://nodejs.org/api/util.html#utilparseargsconfig)
simplicity and [Zod](https://zod.dev/) type safety.

## Install

```bash
npm install zod-parse-args zod
```

## Example

```ts
import { z } from "zod";
import { parseArgs } from "zod-parse-args";

const { name, times, loud } = parseArgs(
  z.object({
    name: z.string().describe("Name to greet"),
    times: z.number().default(1).describe("Number of repetitions"),
    loud: z.boolean().describe("Print in uppercase"),
  }),
  { name: "greet", version: "1.0.0" },
);

for (let i = 0; i < times; i++) {
  console.log(loud ? name.toUpperCase() : name);
}

// $ greet --name World --times 3 --loud
// => { name: "World", times: 3, loud: true }
//
// WORLD
// WORLD
// WORLD
//
// $ greet --help
// Usage: greet [OPTIONS]
//
// Options:
//   --name <string>   Name to greet (required)
//   --times <number>  Number of repetitions (default: 1)
//   --[no-]loud       Print in uppercase
//   --help            Show this help message
//   --version         Show version information
```

## Subcommands

Use [`z.discriminatedUnion()`](https://zod.dev/api#discriminated-unions) to define subcommands:

```ts
import { z } from "zod";
import { parseArgs } from "zod-parse-args";

const args = parseArgs(
  z.discriminatedUnion("command", [
    z
      .object({
        command: z.literal("serve"),
        port: z.number().default(3000).describe("Port to listen on"),
        open: z.boolean().describe("Open in browser"),
      })
      .describe("Start dev server"),
    z
      .object({
        command: z.literal("build"),
        outDir: z.string().default("dist").describe("Output directory"),
        minify: z.boolean().describe("Minify output"),
      })
      .describe("Build for production"),
  ]),
  { name: "app" },
);

// $ app serve --port 8080 --open
// => { command: "serve", port: 8080, open: true }
//
// $ app build --minify
// => { command: "build", outDir: "dist", minify: true }
//
// $ app --help
// Usage: app [OPTIONS] <COMMAND>
//
// Commands:
//   serve  Start dev server
//   build  Build for production
//
// Options:
//   --help  Show this help message
//
// $ app build --help
// Build for production
//
// Usage: app build [OPTIONS]
//
// Options:
//   --out-dir <string>  Output directory (default: "dist")
//   --[no-]minify       Minify output
//   --help              Show this help message
```

## Field Metadata

Control how fields map to CLI arguments with [`.meta()`](https://zod.dev/metadata):

| Key           | Type      | Description                                                |
| ------------- | --------- | ---------------------------------------------------------- |
| `positional`  | `boolean` | Positional argument                                        |
| `long`        | `string`  | Override long option name                                  |
| `short`       | `string`  | Single-character short alias                               |
| `env`         | `string`  | Environment variable fallback                              |
| `metavar`     | `string`  | Custom placeholder in help text                            |
| `description` | `string`  | Same as [`.describe()`](https://zod.dev/metadata#describe) |

All keys are optional. Here's an example using each one:

```ts
import { z } from "zod";
import { parseArgs } from "zod-parse-args";

const args = parseArgs(
  z.object({
    source: z.string().meta({
      positional: true,
      description: "Directory to deploy",
    }),
    targetEnv: z.enum(["dev", "prod"]).meta({
      long: "env",
      description: "Target environment",
    }),
    token: z.string().meta({
      env: "DEPLOY_TOKEN",
      description: "Authentication token",
    }),
    timeout: z.number().default(30).meta({
      metavar: "SECONDS",
      description: "Deploy timeout",
    }),
    force: z.boolean().meta({
      short: "f",
      description: "Skip confirmation prompt",
    }),
  }),
  { name: "ship" },
);

// $ ship ./dist --env prod -f --token secret
// => { source: "./dist", targetEnv: "prod", token: "secret", timeout: 30, force: true }
//
// $ DEPLOY_TOKEN=secret ship ./dist --env dev
// => { source: "./dist", targetEnv: "dev", token: "secret", timeout: 30, force: false }
//
// $ ship --help
// Usage: ship [OPTIONS] <source>
//
// Arguments:
//   <source>  Directory to deploy
//
// Options:
//   --env <dev|prod>     Target environment (required)
//   --token <string>     Authentication token (env: DEPLOY_TOKEN) (required)
//   --timeout <SECONDS>  Deploy timeout (default: 30)
//   -f, --[no-]force     Skip confirmation prompt
//   --help               Show this help message
```

## API

### Options

```ts
interface ParseArgsOptions {
  // Program name for help text
  name?: string;

  // Version string (enables --version)
  version?: string;

  // Arguments to parse (default: process.argv.slice(2))
  args?: string[];

  // Environment variables (default: process.env)
  env?: Record<string, string | undefined>;

  // Help text wrap width
  maxWidth?: number;
}
```

### `parseArgs(schema, options?)`

The main entry point. Returns the parsed and validated result,
or handles `--help`, `--version`, and errors by printing and exiting.

### `safeParseArgs(schema, options?)`

Same as `parseArgs()` but returns a discriminated union instead of exiting:

```ts
type ParseResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "help"; help: string }
  | { kind: "version"; version: string }
  | { kind: "schema-error"; error: string }
  | { kind: "parse-error"; error: string; help: string };
```

### `parseArgsAsync(schema, options?)`

Async version of `parseArgs()`, for schemas with async refinements or transforms.

### `safeParseArgsAsync(schema, options?)`

Async version of `safeParseArgs()`, for schemas with async refinements or transforms.
