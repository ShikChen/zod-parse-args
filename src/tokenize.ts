import { repr } from "./util.ts";
import { HelpRequested, ParseError, VersionRequested } from "./errors.ts";
import type { CommandSpec, SubcommandSpec, Token } from "./types.ts";

function formatAvailableCommands(sub: SubcommandSpec): string {
  return sub.variants.map((v) => v.values[0]).join(", ");
}

class Tokenizer {
  idx = 0;
  posCount = 0;
  afterTerminator = false;
  tokens: Token[] = [];

  private constructor(
    private spec: CommandSpec,
    private args: readonly string[],
  ) {}

  private consumeTupleArgs(label: string, size: number): string[] {
    if (this.idx + size > this.args.length) {
      throw new ParseError(
        `${label}: Expected ${size} values, got ${this.args.length - this.idx}`,
        this.spec,
      );
    }
    const values = this.args.slice(this.idx, this.idx + size);
    this.idx += size;
    return values;
  }

  private tryTokenizeLong(): boolean {
    const arg = this.args[this.idx];
    if (!arg.startsWith("--") || arg.length <= 2) {
      return false;
    }
    this.idx++;
    const eqIdx = arg.indexOf("=");
    const label = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
    const field = this.spec.options.get(label);
    if (field === undefined) {
      if (label === "--help") {
        throw new HelpRequested(this.spec);
      }
      if (label === "--version" && this.spec.version !== null) {
        throw new VersionRequested(this.spec.version);
      }
      throw new ParseError(`Unknown option: ${label}`, this.spec);
    }
    if (field.value.kind === "tuple") {
      if (eqIdx !== -1) {
        throw new ParseError(`${label}: Inline value not supported`, this.spec);
      }
      const value = this.consumeTupleArgs(label, field.value.size);
      this.tokens.push({ kind: "option", field, value, label });
    } else {
      const value = (() => {
        if (field.value.kind === "bool") {
          const isNeg = label === `--no-${field.long}`;
          if (eqIdx !== -1) {
            if (isNeg) {
              throw new ParseError(`${label}: Negated option does not accept a value`, this.spec);
            }
            return arg.slice(eqIdx + 1);
          }
          return isNeg ? "false" : "true";
        }
        if (eqIdx !== -1) return arg.slice(eqIdx + 1);
        if (this.idx < this.args.length) return this.args[this.idx++];
        throw new ParseError(`${label}: Missing value`, this.spec);
      })();
      this.tokens.push({ kind: "option", field, value, label });
    }
    return true;
  }

  private tryTokenizeShort(): boolean {
    const arg = this.args[this.idx];
    if (!arg.startsWith("-") || arg.startsWith("--") || arg.length <= 1) {
      return false;
    }
    this.idx++;
    for (let i = 1; i < arg.length; i++) {
      const label = `-${arg[i]}`;
      const field = this.spec.options.get(label);
      if (field === undefined) {
        throw new ParseError(`Unknown option: ${label}`, this.spec);
      }
      if (field.value.kind === "tuple") {
        if (arg[i + 1] === "=") {
          throw new ParseError(`${label}: Inline value not supported`, this.spec);
        }
        if (i !== arg.length - 1) {
          throw new ParseError(
            `${label}: Tuple option must be last in a short option cluster`,
            this.spec,
          );
        }
        const value = this.consumeTupleArgs(label, field.value.size);
        this.tokens.push({ kind: "option", field, value, label });
        break;
      }
      if (arg[i + 1] === "=") {
        this.tokens.push({
          kind: "option",
          field,
          value: arg.slice(i + 2),
          label,
        });
        break;
      }
      if (field.value.kind === "bool") {
        this.tokens.push({ kind: "option", field, value: "true", label });
      } else if (i + 1 < arg.length) {
        this.tokens.push({
          kind: "option",
          field,
          value: arg.slice(i + 1),
          label,
        });
        break;
      } else if (this.idx < this.args.length) {
        this.tokens.push({
          kind: "option",
          field,
          value: this.args[this.idx++],
          label,
        });
      } else {
        throw new ParseError(`${label}: Missing value`, this.spec);
      }
    }
    return true;
  }

  private tryTokenizePositional(): boolean {
    if (this.posCount >= this.spec.positionals.length) {
      return false;
    }
    const field = this.spec.positionals[this.posCount];
    if (field.value.kind !== "array") this.posCount++;
    if (field.value.kind === "tuple") {
      const value = this.consumeTupleArgs(`<${field.target}>`, field.value.size);
      this.tokens.push({ kind: "positional", field, value });
    } else {
      const value = this.args[this.idx++];
      this.tokens.push({ kind: "positional", field, value });
    }
    return true;
  }

  private tryTokenizeSubcommand(): boolean {
    if (this.spec.subcommand === null) {
      return false;
    }
    const arg = this.args[this.idx++];
    const subSpec = this.spec.subcommand;
    const variant = subSpec.variants.find((v) => v.values.includes(arg));
    if (variant === undefined) {
      throw new ParseError(
        `Unknown command: ${arg}. Available: ${formatAvailableCommands(subSpec)}`,
        this.spec,
      );
    }
    this.tokens.push({
      kind: "subcommand",
      subcommand: subSpec,
      command: variant.spec,
      value: arg,
    });
    this.spec = variant.spec;
    this.posCount = 0;
    return true;
  }

  private tryTokenizeNext(): boolean {
    if (this.afterTerminator) return this.tryTokenizePositional();
    if (this.args[this.idx] === "--") {
      this.idx++;
      this.afterTerminator = true;
      return true;
    }
    return (
      this.tryTokenizeLong() ||
      this.tryTokenizeShort() ||
      this.tryTokenizePositional() ||
      this.tryTokenizeSubcommand()
    );
  }

  private tokenizeAll(): Token[] {
    while (this.idx < this.args.length) {
      if (!this.tryTokenizeNext()) {
        throw new ParseError(`Unexpected argument: ${repr(this.args[this.idx])}`, this.spec);
      }
    }

    if (this.spec.subcommand !== null && !this.spec.subcommand.optional) {
      throw new ParseError(
        `Missing command. Available: ${formatAvailableCommands(this.spec.subcommand)}`,
        this.spec,
      );
    }

    return this.tokens;
  }

  static run(spec: CommandSpec, args: readonly string[]): Token[] {
    const tokenizer = new Tokenizer(spec, args);
    return tokenizer.tokenizeAll();
  }
}

export function tokenize(spec: CommandSpec, args: readonly string[]): Token[] {
  return Tokenizer.run(spec, args);
}
