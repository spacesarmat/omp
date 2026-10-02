import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('assets/icon.svg', 'utf8');
for (const [file, size] of [['webos/icon.png', 80], ['webos/largeIcon.png', 130]]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(file, png);
  console.log('wrote', file, size + 'x' + size);
}
