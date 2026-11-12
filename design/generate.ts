import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DESIGN_TARGETS, type DesignTarget, type FlowDocument, type LayoutDocument, type ThemeDocument } from './schema.ts';
import { generateThemeCss } from './theme.ts';
import { FLOW_MODULE_OUTPUT, generateFlowModule } from './flow-module.ts';
import { parseFlowDocument, parseThemeDocument } from './validation.ts';

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

const LAYOUT_OUTPUT = 'design/generated/layout.ts';

// The production runtime imports this module. It carries only validated layout data as
// JSON, so preview and production share the same document after an explicit export.
export function generateLayoutModule(layout: LayoutDocument | undefined): string {
  const document: LayoutDocument = {
    containers: layout?.containers ?? [],
    placements: layout?.placements ?? [],
    ...(layout?.clones?.length ? { clones: layout.clones } : {}),
  };
  return [
    "import type { LayoutDocument } from '../schema.ts';",
    '',
    '// Generated from design/themes. The export step rewrites this file with the reviewed',
    '// layout document; an empty document keeps the production runtime a no-op.',
    `export const PRODUCTION_LAYOUT: LayoutDocument = ${JSON.stringify(document, null, 2)};`,
    '',
  ].join('\n');
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

// The production runtime reads a single generated module, so the first flow document
// (sorted by file name) is the generated source, mirroring the single committed design.
async function sourceFlow(root: string): Promise<FlowDocument | null> {
  const directory = join(root, 'design', 'flows');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const first = names.filter((entry) => entry.endsWith('.json')).sort()[0];
  if (!first) return null;
  return parseFlowDocument(JSON.parse(await readFile(join(directory, first), 'utf8')));
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
    const layout = generateLayoutModule(theme.layout);
    files.push({
      path: LAYOUT_OUTPUT,
      content: layout,
      sha256: createHash('sha256').update(layout).digest('hex'),
    });
  }
  const flow = await sourceFlow(root);
  if (flow) {
    const module = generateFlowModule(flow);
    files.push({
      path: FLOW_MODULE_OUTPUT,
      content: module,
      sha256: createHash('sha256').update(module).digest('hex'),
    });
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
