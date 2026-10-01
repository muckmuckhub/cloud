/**
 * Argument parsing, such as it is.
 *
 * Deliberately not a parser library: ten commands with a handful of flags do
 * not need one. What they do need is to agree, which they did not — each
 * command re-implemented its own scan, so `cloud logs --context prod lobby`
 * treated "prod" as the service name and tailed the wrong thing.
 */

/** Flags that consume the token after them, which is therefore not a value. */
const VALUE_FLAGS = new Set(["--context", "--prompt", "--tail"]);

export function optionValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function hasFlag(argv: string[], ...names: string[]): boolean {
  return names.some((n) => argv.includes(n));
}

/**
 * The arguments that are not flags, and not a flag's value.
 *
 * `cloud logs --context prod lobby -f` gives `["lobby"]`.
 */
export function positionals(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) {
      i++; // skip its value
      continue;
    }
    if (arg.startsWith("-")) continue;
    out.push(arg);
  }
  return out;
}
