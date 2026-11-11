import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DESIGN_TARGETS, type DesignTarget, type ThemeDocument } from './schema.ts';
import { generateThemeCss } from './theme.ts';
import { parseThemeDocument } from './validation.ts';

export interface GeneratedFile {
  path: string;
  sha256: string;
}

interface GeneratedContent extends GeneratedFile {
  content: string;
}

function outputName(target: DesignTarget): string {
  return `design/generated/${target}.css`;
}

async function sourceThemes(root: string): Promise<ThemeDocument[]> {
  const directory = join(root, 'design', 'themes');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const themes: ThemeDocument[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    const source = await readFile(join(directory, name), 'utf8');
    themes.push(parseThemeDocument(JSON.parse(source)));
  }
  return themes;
}

async function expectedFiles(root: string): Promise<GeneratedContent[]> {
  const themes = await sourceThemes(root);
  const files: GeneratedContent[] = [];
  for (const theme of themes) {
    for (const target of DESIGN_TARGETS) {
      const content = generateThemeCss(theme, target);
      files.push({
        path: outputName(target),
        content,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function writeGeneratedThemes(root: string): Promise<GeneratedFile[]> {
  const files = await expectedFiles(root);
  for (const file of files) {
    const destination = join(root, file.path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
  return files.map(({ path, sha256 }) => ({ path, sha256 }));
}

export async function checkGeneratedThemes(root: string): Promise<void> {
  const files = await expectedFiles(root);
  for (const file of files) {
    let current: string;
    try {
      current = await readFile(join(root, file.path), 'utf8');
    } catch {
      throw new Error(`GENERATED_OUTDATED: ${file.path}`);
    }
    if (current !== file.content) throw new Error(`GENERATED_OUTDATED: ${file.path}`);
  }
}
