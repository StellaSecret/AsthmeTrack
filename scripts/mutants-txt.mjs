#!/usr/bin/env node
// Parses a Stryker mutation report (MTR JSON, default reports/mutation/mutation.json)
// and writes cargo-mutants-style artifacts so the CI workflow can follow the same
// caught/missed/unviable format as the reference mutants.yml.
//
// Usage: node scripts/mutants-txt.mjs <mutation.json> <outDir>
//
// Exit codes:
//   0 = ran, no missed mutants (artifacts written)
//   1 = ran, at least one missed (survived or uncovered) mutant
//   2 = report missing / unparseable / no mutants reported
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const jsonPath = args[0];
const outDir = args[1];
let excludeRe = null;
const optIdx = args.indexOf('--exclude-re');
if (optIdx !== -1 && args[optIdx + 1]) excludeRe = args[optIdx + 1];

if (!jsonPath || !outDir) {
  console.error('usage: node scripts/mutants-txt.mjs <mutation.json> <outDir> [--exclude-re <regex>]');
  process.exit(2);
}

const excluded = excludeRe ? new RegExp(excludeRe) : null;

let report;
try {
  report = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (err) {
  console.error(`FATAL: cannot read/parse mutation report ${jsonPath}: ${err.message}`);
  process.exit(2);
}

const files = report.files || {};
const caught = [];
const missed = [];
const unviable = [];

const line = (file, mutant) => {
  const { start } = mutant.location || { start: {} };
  const lineNo = start.line != null ? start.line : '?';
  const col = start.column != null ? start.column + 1 : '?';
  return `${file}:${lineNo}:${col}:${mutant.mutatorName || 'mutator'} [${mutant.id}]`;
};

let total = 0;
for (const [file, fileResult] of Object.entries(files)) {
  for (const mutant of fileResult.mutants || []) {
    const ref = line(file, mutant);
    if (excluded && excluded.test(ref)) {
      // Mirror of cargo-mutants --exclude-re: these mutants are not scored.
      console.log(`Excluded (exclude-re): ${ref}`);
      continue;
    }
    total += 1;
    switch (mutant.status) {
      case 'Killed':
      case 'Timeout':
        caught.push(line(file, mutant));
        break;
      case 'Survived':
      case 'NoCoverage':
        missed.push(line(file, mutant));
        break;
      case 'CompileError':
      case 'RuntimeError':
        unviable.push(line(file, mutant));
        break;
      default:
        // Ignored, Pending, etc. are not counted, matching cargo-mutants.
        total -= 1;
        break;
    }
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'caught.txt'), caught.join('\n') + (caught.length ? '\n' : ''));
writeFileSync(join(outDir, 'missed.txt'), missed.join('\n') + (missed.length ? '\n' : ''));
writeFileSync(join(outDir, 'unviable.txt'), unviable.join('\n') + (unviable.length ? '\n' : ''));

console.log(`Mutants: ${total} total — ${caught.length} caught, ${missed.length} missed, ${unviable.length} unviable`);
console.log(`Artifacts written to ${outDir}/`);

if (total === 0) {
  console.error('FATAL: no (countable) mutants found in report');
  process.exit(2);
}
if (missed.length > 0) {
  console.error(`FAIL: ${missed.length} mutant(s) not detected by tests:`);
  for (const m of missed) console.error(`  ${m}`);
  process.exit(1);
}
process.exit(0);