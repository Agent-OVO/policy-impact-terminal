#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(process.cwd());
const outputDirectory = path.resolve(projectRoot, "dist");
const relativePath = path.relative(projectRoot, outputDirectory);

if (
  relativePath !== "dist" ||
  path.basename(outputDirectory).toLowerCase() !== "dist" ||
  outputDirectory === projectRoot
) {
  throw new Error(`Refusing to clean unexpected build output path: ${outputDirectory}`);
}

await fs.rm(outputDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
console.log(`[build:clean] removed ${outputDirectory}`);
