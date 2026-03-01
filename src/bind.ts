import { assert, assertNever, enumerateOptionFields } from "./util";
import type { BoundInput, CommandSpec, Env, FieldSpec, InputRecord, Token } from "./types";

export function bindArgs(spec: CommandSpec, tokens: Token[], env: Env): BoundInput {
  const input: InputRecord = Object.create(null);
  let curInput: InputRecord = input;
  const specs: CommandSpec[] = [spec];

  function setValue(field: FieldSpec, value: string | string[]) {
    if (Array.isArray(value)) {
      assert(field.value.kind === "tuple", "Unexpected array value for non-tuple field");
      assert(
        value.length === field.value.size,
        `Expected ${field.value.size} values for tuple field, got ${value.length}`,
      );
      curInput[field.target] = value;
    } else if (field.value.kind === "array") {
      const curVal = curInput[field.target];
      if (Array.isArray(curVal)) {
        curVal.push(value);
      } else {
        curInput[field.target] = [value];
      }
    } else {
      assert(field.value.kind !== "tuple", "Unexpected string value for tuple field");
      curInput[field.target] = value;
    }
  }

  function applyEnv() {
    const fields = [...enumerateOptionFields(spec), ...spec.positionals];
    for (const field of fields) {
      if (Object.hasOwn(curInput, field.target)) continue;
      if (field.env === null || !Object.hasOwn(env, field.env)) continue;
      let val = env[field.env];
      if (val === undefined) continue;
      if (field.value.kind === "bool" && val === "") val = "true";
      setValue(field, val);
    }
  }

  for (const token of tokens) {
    if (token.kind === "option") {
      const { field, value } = token;
      setValue(field, value);
    } else if (token.kind === "positional") {
      setValue(token.field, token.value);
    } else if (token.kind === "subcommand") {
      const { subcommand, command, value } = token;
      applyEnv();
      if (subcommand.key !== null) {
        const subInput: InputRecord = Object.create(null);
        subInput[subcommand.discriminator] = value;
        curInput[subcommand.key] = subInput;
        curInput = subInput;
      } else {
        input[subcommand.discriminator] = value;
      }
      spec = command;
      specs.push(spec);
    } else {
      assertNever(token);
    }
  }

  applyEnv();
  return { input, specs };
}
