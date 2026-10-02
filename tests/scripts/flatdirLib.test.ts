import { describe, it, expect } from 'vitest';
import { stripFlatDir } from '../../scripts/flatdir-lib.mjs';

describe('stripFlatDir', () => {
  it('removes the flatDir block and keeps other repositories', () => {
    const src = "repositories {\n    google()\n    mavenCentral()\n    flatDir{\n        dirs 'src/main/libs', 'libs'\n    }\n}\n";
    expect(stripFlatDir(src)).toBe('repositories {\n    google()\n    mavenCentral()\n}\n');
  });
  it('handles CRLF and a space before the brace', () => {
    const src = 'repositories {\r\n    flatDir {\r\n        dirs \'libs\'\r\n    }\r\n}\r\n';
    expect(stripFlatDir(src)).toBe('repositories {\r\n}\r\n');
  });
  it('leaves files without flatDir unchanged', () => {
    const src = 'repositories {\n    google()\n}\n';
    expect(stripFlatDir(src)).toBe(src);
  });
});
