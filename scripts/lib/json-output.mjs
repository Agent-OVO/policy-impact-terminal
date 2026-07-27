export function stringifyJsonForOutput(value, options = {}) {
  const indent = Number.isInteger(options.indent) ? options.indent : 2;
  const asciiSafe = options.asciiSafe ?? (process.platform === "win32" || process.stdout.isTTY !== true);
  const json = JSON.stringify(value, null, indent);
  return asciiSafe ? escapeNonAscii(json) : json;
}

export function printJson(value, options = {}) {
  process.stdout.write(`${stringifyJsonForOutput(value, options)}\n`);
}

function escapeNonAscii(value) {
  return value.replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
