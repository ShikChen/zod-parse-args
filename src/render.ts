import * as z from "zod/v4/core";
import { assert, enumerateOptionFields, repr } from "./util.ts";
import type { BoundInput, CommandSpec, FieldSpec, ParseArgsOptions } from "./types.ts";

interface HelpItem {
  label: string;
  description: string;
}

function renderMetavar(labels: string[], brackets: "<>" | "[]"): string {
  return labels.map((label) => `${brackets[0]}${label}${brackets[1]}`).join(" ");
}

function wordWrap(text: string, maxWidth: number): string[] {
  // TODO: Handle ascii escape codes with colors.
  // TODO: Handle CJK characters that are wider than 1 column.
  // TODO: Handle emoji.
  const lines: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  function flush() {
    if (curLen === 0) return;
    lines.push(cur.join(""));
    cur = [];
    curLen = 0;
  }
  function push(word: string) {
    if (curLen + word.length > maxWidth) flush();
    if (curLen === 0) word = word.trimStart();
    // TODO: hard-wrap
    cur.push(word);
    curLen += word.length;
  }
  for (const line of text.split("\n")) {
    for (const match of line.matchAll(/\s*\S+/g)) {
      const word = match[0];
      push(word);
    }
    flush();
  }
  return lines;
}

function renderPositionalMetavar(field: FieldSpec): string {
  if (field.value.kind === "array") {
    return `${renderMetavar(field.metavar, field.optional ? "[]" : "<>")}...`;
  }
  if (field.value.kind === "tuple" && field.optional) {
    return `[${renderMetavar(field.metavar, "<>")}]`;
  }
  return field.optional ? renderMetavar(field.metavar, "[]") : renderMetavar(field.metavar, "<>");
}

function renderCommandPath(spec: CommandSpec): string {
  const names = [];
  let cur: CommandSpec = spec;
  while (cur.parent !== null) {
    const parent = cur.parent;
    assert(parent.subcommand !== null, "Parent command missing subcommand spec");
    const variant = parent.subcommand.variants.find((v) => v.spec === cur);
    assert(variant !== undefined, "Failed to find subcommand variant for command");
    names.push(variant.values[0]);
    cur = parent;
  }
  return names.reverse().join(" ");
}

function renderAlignedSection(items: HelpItem[], maxWidth: number): string {
  const indent = 2;
  const gap = 2;
  const longestLabelWidth = Math.max(...items.map((x) => x.label.length), 0);
  const labelWidth = Math.max(0, Math.min(longestLabelWidth, (maxWidth >> 1) - indent - gap));
  const descWidth = maxWidth - (indent + labelWidth + gap);
  const lines: string[] = [];
  for (const { label, description } of items) {
    if (description.trim() === "") {
      lines.push(" ".repeat(indent) + label);
      continue;
    }
    const descLines = wordWrap(description, descWidth);
    assert(descLines.length > 0, "Unexpected empty description lines");
    if (label.length <= labelWidth) {
      lines.push(
        [" ".repeat(indent), label.padEnd(labelWidth), " ".repeat(gap), descLines.shift()].join(""),
      );
    } else {
      lines.push(" ".repeat(indent) + label);
    }
    for (const line of descLines) {
      lines.push(" ".repeat(indent + labelWidth + gap) + line);
    }
  }

  return lines.join("\n");
}

export function renderHelp(spec: CommandSpec, opts: ParseArgsOptions): string {
  const { name, maxWidth = 80 } = opts;

  const lines = [];
  if (spec.description !== null) {
    lines.push(spec.description, "");
  }

  const usage = ["Usage:"];
  if (name !== undefined) usage.push(name);
  usage.push(renderCommandPath(spec));
  usage.push("[OPTIONS]");
  if (spec.positionals.length > 0) {
    for (const pos of spec.positionals) {
      usage.push(renderPositionalMetavar(pos));
    }
  }
  if (spec.subcommand !== null) {
    const { optional, metavar } = spec.subcommand;
    usage.push(optional ? `[${metavar}]` : `<${metavar}>`);
  }
  lines.push(usage.filter((x) => x.length > 0).join(" "), "");

  if (spec.positionals.length > 0) {
    lines.push("Arguments:");
    const items = spec.positionals.map(
      (pos): HelpItem => ({
        label: renderPositionalMetavar(pos),
        description: pos.description ?? "",
      }),
    );
    lines.push(renderAlignedSection(items, maxWidth));
    lines.push("");
  }

  if (spec.subcommand !== null) {
    lines.push("Commands:");
    const items = spec.subcommand.variants.map(
      (variant): HelpItem => ({
        label: variant.values.join(", "),
        description: variant.spec.description ?? "",
      }),
    );
    lines.push(renderAlignedSection(items, maxWidth));
    lines.push("");
  }

  const optItems: HelpItem[] = [];
  for (const opt of enumerateOptionFields(spec)) {
    const long = opt.value.kind === "bool" ? `[no-]${opt.long}` : `${opt.long}`;
    const label = [
      opt.short !== null ? `-${opt.short}, --${long}` : `--${long}`,
      opt.value.kind !== "bool" ? renderMetavar(opt.metavar, "<>") : "",
    ].join(" ");
    const desc = [];
    if (opt.description !== null) desc.push(opt.description);
    if (opt.choices !== null) desc.push(`(choices: ${opt.choices.join(", ")})`);
    if (opt.value.kind === "array") desc.push("(multi)");
    if (opt.env !== null) desc.push(`(env: ${opt.env})`);
    if (opt.defaultValue !== undefined) desc.push(`(default: ${repr(opt.defaultValue)})`);
    if (!opt.optional) desc.push("(required)");
    optItems.push({ label, description: desc.join(" ") });
  }
  if (!spec.options.has("--help")) {
    optItems.push({ label: "--help", description: "Show this help message" });
  }
  if (!spec.options.has("--version") && spec.version !== null) {
    optItems.push({
      label: "--version",
      description: "Show version information",
    });
  }
  lines.push("Options:");
  lines.push(renderAlignedSection(optItems, maxWidth));

  return lines.join("\n").trimEnd();
}

function resolveLabel(specs: CommandSpec[], path: PropertyKey[]): string {
  if (path.length === 0) {
    return "<input>";
  }
  if (specs[0]?.subcommand?.key === null) {
    specs = specs.slice(1);
  }
  for (let i = 0; i < specs.length; i++) {
    const key = path[i];
    const spec = specs[i];
    if (spec.subcommand !== null && spec.subcommand.key === key) {
      continue;
    }
    for (const field of enumerateOptionFields(spec)) {
      if (field.target === key) return `--${field.long}`;
    }
    for (const { target, metavar, value } of spec.positionals) {
      if (target === key) {
        return `${renderMetavar(metavar, "<>")}${value.kind === "array" ? "..." : ""}`;
      }
    }
    // Failed to match, the schema might be refinement that provides custom paths.
    break;
  }
  // Fallback to raw path if we can't resolve a label. This can happen with refinements.
  return path.map((x) => String(x)).join(".");
}

export function renderZodError(error: z.$ZodError, bound: BoundInput): string {
  // Show only the first error to avoid overwhelming the user with messages.
  const issue = error.issues[0];
  assert(issue !== undefined, "Unexpected empty error issues");

  let message = issue.message;

  if (issue.code === "invalid_key" && issue.issues.length > 0) {
    message = `${message} (${issue.issues[0].message})`;
  }

  const label = resolveLabel(bound.specs, issue.path);
  return `${label}: ${message}`;
}
