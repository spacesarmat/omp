// @vitest-environment node
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { inheritExportManifest } from '../../editor/export.mjs';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), writeFile: vi.fn(actual.writeFile) };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const roots: string[] = [];

function diskError() {
  return Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('removes only a newly created manifest after a partial write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-manifest-'));
  roots.push(root);
  const exports = join(root, '.omp-editor', 'exports');
  await mkdir(exports, { recursive: true });
  await writeFile(join(exports, 'original.json'), JSON.stringify({
    schemaVersion: 1,
    draftId: 'original',
    files: [{ path: 'design/themes/default.json', sha256: 'a'.repeat(64) }],
  }));
  vi.mocked(writeFile).mockImplementation(async (path, data, options) => {
    if (String(path).endsWith('copy.json')) {
      await actualFs.writeFile(path, '{"partial"', options);
      throw diskError();
    }
    return actualFs.writeFile(path, data, options);
  });
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    const handle = await actualFs.open(path, flags, mode);
    if (String(path).endsWith('copy.json')) {
      handle.writeFile = async () => {
        await actualFs.writeFile(path, '{"partial"');
        throw diskError();
      };
    }
    return handle;
  });

  await expect(inheritExportManifest(root, 'original', 'copy')).rejects.toMatchObject({ code: 'ENOSPC' });
  await expect(readFile(join(exports, 'copy.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('keeps a pre-existing manifest after a conflicting copy', async () => {
  vi.mocked(writeFile).mockImplementation(actualFs.writeFile);
  vi.mocked(open).mockImplementation(actualFs.open);
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-manifest-'));
  roots.push(root);
  const exports = join(root, '.omp-editor', 'exports');
  await mkdir(exports, { recursive: true });
  await actualFs.writeFile(join(exports, 'original.json'), JSON.stringify({
    schemaVersion: 1,
    draftId: 'original',
    files: [{ path: 'design/themes/default.json', sha256: 'a'.repeat(64) }],
  }));
  await actualFs.writeFile(join(exports, 'copy.json'), 'pre-existing manifest');

  await expect(inheritExportManifest(root, 'original', 'copy')).rejects.toMatchObject({ code: 'EXPORT_MANIFEST_EXISTS' });
  await expect(readFile(join(exports, 'copy.json'), 'utf8')).resolves.toBe('pre-existing manifest');
});
