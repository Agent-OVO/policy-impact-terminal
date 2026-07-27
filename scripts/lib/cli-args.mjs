export function parseCliArgs(values, options = {}) {
  const positionalKey = options.positionalKey ?? "_";
  const keepPositionals = options.keepPositionals !== false;
  const parsed = keepPositionals ? { [positionalKey]: [] } : {};

  for (const value of values) {
    if (!value.startsWith("--")) {
      if (keepPositionals) parsed[positionalKey].push(value);
      continue;
    }

    const body = value.slice(2);
    const separator = body.indexOf("=");
    const key = separator >= 0 ? body.slice(0, separator) : body;
    const raw = separator >= 0 ? body.slice(separator + 1) : "true";
    if (!key) continue;
    parsed[key] = raw;
  }

  return parsed;
}
