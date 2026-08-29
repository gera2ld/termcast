import { nanoid } from "nanoid";

export function generateSessionKey(): string {
  return `tc_${nanoid(43)}`;
}

export function parseArgs(command: string | undefined): string[] {
  if (!command) return [];
  const args: string[] = [];
  let arg = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  const push = () => {
    if (arg) {
      args.push(arg);
      arg = "";
    }
  };

  for (const char of command) {
    if (escaping) {
      arg += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        arg += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n") {
      push();
      continue;
    }
    arg += char;
  }
  if (escaping) arg += "\\";
  push();
  return args;
}

export function formatArgs(args: string[]): string {
  return args.map((arg) => (arg.match(/[\s"']/) ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(" ");
}
