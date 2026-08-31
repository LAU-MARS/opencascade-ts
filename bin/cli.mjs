#!/usr/bin/env node
import("../dist/cli.js")
  .then((module) => module.main(process.argv.slice(2)))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
