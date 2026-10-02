import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const svg = readFileSync('assets/icon.svg', 'utf8');
for (const [file, size] of [['webos/icon.png', 80], ['webos/largeIcon.png', 130]]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(file, png);
  console.log('wrote', file, size + 'x' + size);
}

// Android launcher icons (Capacitor project in android/)
const res = 'android/app/src/main/res';
if (existsSync(res)) {
  const bg = '#0F1115';
  const glyph = svg.replace(/<rect x="0" y="0"[^>]*\/>\s*/, '');
  const round = svg.replace(/rx="20"/, 'rx="50"');
  // foreground: glyph in the central ~62% of the 108dp adaptive canvas (safe zone)
  const fg = glyph.replace(/viewBox="[^"]*"/, 'viewBox="-30 -30 160 160"');
  const dens = [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]];
  for (const [d, size] of dens) {
    const dir = `${res}/mipmap-${d}`;
    mkdirSync(dir, { recursive: true });
    const png = (s, w) => new Resvg(s, { fitTo: { mode: 'width', value: w } }).render().asPng();
    writeFileSync(`${dir}/ic_launcher.png`, png(svg, size));
    writeFileSync(`${dir}/ic_launcher_round.png`, png(round, size));
    writeFileSync(`${dir}/ic_launcher_foreground.png`, png(fg, Math.round((size * 108) / 48)));
    console.log('wrote', dir, size);
  }
  writeFileSync(
    `${res}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg}</color>\n</resources>\n`,
  );
}
