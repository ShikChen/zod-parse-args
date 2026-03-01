import type { CommandSpec } from "./types";

class CustomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class SchemaError extends CustomError {}

export class ParseError extends CustomError {
  constructor(
    message: string,
    public spec: CommandSpec,
  ) {
    super(message);
  }
}

export class AssertionError extends CustomError {}

export class HelpRequested extends CustomError {
  constructor(public spec: CommandSpec) {
    super("Help requested");
  }
}

export class VersionRequested extends CustomError {
  constructor(public version: string) {
    super("Version requested");
  }
}
