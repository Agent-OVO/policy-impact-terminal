#!/usr/bin/env node
import assert from "node:assert/strict";
import { stringifyJsonForOutput } from "./lib/json-output.mjs";

const value = {
  title: "政策附件完整性测试",
  reason: "等待PDF、OFD和DOC附件"
};
const ascii = stringifyJsonForOutput(value, { asciiSafe: true });
assert.match(ascii, /\\u653f\\u7b56/);
assert.deepEqual(JSON.parse(ascii), value);
assert.doesNotMatch(ascii, /政策附件/);

const unicode = stringifyJsonForOutput(value, { asciiSafe: false });
assert.match(unicode, /政策附件完整性测试/);
assert.deepEqual(JSON.parse(unicode), value);

console.log("[manual:output-test] ASCII-safe pipe output and readable Unicode output both preserve JSON semantics");
