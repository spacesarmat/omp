import { checkGeneratedThemes, writeGeneratedThemes } from '../design/generate.ts';

const check = process.argv.includes('--check');
const unknown = process.argv.slice(2).filter((argument) => argument !== '--check');
if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(', ')}`);

try {
  if (check) {
    await checkGeneratedThemes(process.cwd());
    console.log('design: generated CSS is up to date');
  } else {
    const files = await writeGeneratedThemes(process.cwd());
    for (const file of files) console.log(`design: ${file.path} ${file.sha256}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
