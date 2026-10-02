import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';

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

  // Splash: dark background + logo (no tile) at ~30% of the short side, same files/sizes as before
  const logoInner = glyph.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  for (const d of readdirSync(res).filter((n) => n.startsWith('drawable'))) {
    const file = `${res}/${d}/splash.png`;
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const L = Math.round(Math.min(w, h) * 0.3);
    const splash =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="100%" height="100%" fill="${bg}"/>` +
      `<svg x="${Math.round((w - L) / 2)}" y="${Math.round((h - L) / 2)}" width="${L}" height="${L}" viewBox="0 0 100 100">${logoInner}</svg></svg>`;
    writeFileSync(file, new Resvg(splash, { fitTo: { mode: 'original' } }).render().asPng());
    console.log('wrote', file, w + 'x' + h);
  }
  // Android TV launcher banner 320x180 (xhdpi): dark tile, logo + OMP / Open Movie Player
  const bannerDir = `${res}/drawable-xhdpi`;
  mkdirSync(bannerDir, { recursive: true });
  const banner =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">` +
    `<rect width="320" height="180" fill="${bg}"/>` +
    `<svg x="46" y="48" width="84" height="84" viewBox="0 0 100 100"><rect x="14" y="22" width="72" height="56" rx="10" fill="none" stroke="#F5B700" stroke-width="7"/>` +
    `<path d="M44 41 L59 50 L44 59 Z" fill="#E8EAF0" stroke="#E8EAF0" stroke-width="4" stroke-linejoin="round"/></svg>` +
    `<text x="148" y="94" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="40" fill="#E8EAF0">OMP</text>` +
    `<text x="149" y="116" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#9AA1B2">Open Movie Player</text></svg>`;
  writeFileSync(`${bannerDir}/banner.png`, new Resvg(banner, { fitTo: { mode: 'original' }, font: { loadSystemFonts: true } }).render().asPng());
  console.log('wrote', `${bannerDir}/banner.png`, '320x180');
  writeFileSync(
    `${res}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg}</color>\n</resources>\n`,
  );
}
