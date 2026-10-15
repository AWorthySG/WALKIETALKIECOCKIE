import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Text left behind when a tool truncates a file it was asked to copy or upload.
const MARKERS = [/\.\.\. \d+ bytes omitted \.\.\./, /\[\d+ (?:bytes|characters|lines) truncated\]/i];

// Throws unless `source` is a complete, parseable ES module.
export function assertCompleteModule(source, label) {
  for (const marker of MARKERS) if (marker.test(source)) throw Error(`${label} contains a truncation marker (${marker}).`);
  const dir = mkdtempSync(join(tmpdir(), 'bundle-check-'));
  try {
    const file = join(dir, 'module.mjs');
    writeFileSync(file, source);
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw Error(`${label} is not valid JavaScript:\n${result.stderr.split('\n').slice(0, 6).join('\n')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
