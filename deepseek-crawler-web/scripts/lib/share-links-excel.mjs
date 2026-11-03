import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pythonScript = path.join(__dirname, '..', 'deepseek_share_links_excel.py');

function resolvePython() {
  for (const candidate of ['python3', 'python']) {
    try {
      const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
      if (result.status === 0) return candidate;
    } catch {
      // try next
    }
  }
  return 'python3';
}

export function writeShareLinksExcel(dataset, outDir) {
  const outPath = path.join(outDir, 'share-links.xlsx');
  const python = resolvePython();
  const result = spawnSync(python, [pythonScript, '--out', outPath], {
    input: JSON.stringify(dataset),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { ok: false, path: outPath, error: `${result.stderr || result.stdout || 'failed'}`.trim() };
  }
  return { ok: true, path: outPath };
}
