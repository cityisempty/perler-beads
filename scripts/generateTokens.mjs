#!/usr/bin/env node
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_COUNT = 100;
const OUTPUT_DIR = resolve(process.cwd(), 'scripts', 'output');
const BASE_URL = process.env.PERLERCRAFT_BASE_URL ?? 'https://your-domain.example/perlercraft';

function parseCount() {
  const countArg = process.argv.find((arg) => arg.startsWith('--count='));
  if (!countArg) return DEFAULT_COUNT;

  const parsed = Number(countArg.split('=')[1]);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid count value: ${countArg}. Use "--count=2500".`);
  }
  return Math.floor(parsed);
}

function ensureOutputDir() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function maskToken(token) {
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function main() {
  const count = parseCount();
  ensureOutputDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const batchName = `token-batch-${timestamp}`;

  const csvLines = ['token,hash,url'];
  const hashList = [];

  for (let i = 0; i < count; i += 1) {
    const token = randomUUID();
    const tokenHash = sha256Hex(token);
    hashList.push(tokenHash);

    const link = `${BASE_URL}?code=${tokenHash}`;
    csvLines.push(`${token},${tokenHash},${link}`);
  }

  const csvPath = resolve(OUTPUT_DIR, `${batchName}.csv`);
  writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

  const hashPath = resolve(OUTPUT_DIR, `${batchName}-hashes.json`);
  writeFileSync(hashPath, JSON.stringify(hashList, null, 2), 'utf8');

  const tsPath = resolve(OUTPUT_DIR, `${batchName}-hashes.ts`);
  const tsContent = `// Generated ${new Date().toISOString()}\nconst tokenHashes = ${JSON.stringify(
    hashList,
    null,
    2
  )} as const;\n\nexport default Array.from(tokenHashes);\n`;
  writeFileSync(tsPath, tsContent, 'utf8');

  console.log(`Generated ${count} tokens.`);
  console.log(`Sample links:`);
  csvLines.slice(1, Math.min(6, csvLines.length)).forEach((line) => {
    const parts = line.split(',');
    const tokenHash = parts[1] ?? '';
    const url = parts[2] ?? '';
    console.log(`  ${maskToken(tokenHash)} -> ${url}`);
  });
  console.log('\nOutputs:');
  console.log(`  ${csvPath}`);
  console.log(`  ${hashPath}`);
  console.log(`  ${tsPath}`);
  console.log('\nCopy the array from the generated *.ts file into src/data/tokenHashes.ts to activate this batch.');
}

main();
