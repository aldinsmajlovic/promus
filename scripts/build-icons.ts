import { mkdirSync, writeFileSync } from 'node:fs';
import { openSync, type Font } from 'fontkit';
import sharp from 'sharp';

const FONT = 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2';
const OUT = 'apps/web/public/icons';
const DARK = '#354E16';
const LIGHT = '#CDEDA3';

const font = openSync(FONT) as Font;
// getVariation() re-decodes the raw (compressed) WOFF2 bytes, so set the coords on the font directly.
font.getGlyph(0); // decode the WOFF2 glyf table while no variation is set (fontkit crashes on composites otherwise)
const want: Record<string, number> = { wght: 700, SOFT: 100, WONK: 1, opsz: 144 };
(font as any).variationCoords = font.fvar.axis.map((a: any) => want[a.axisTag.trim()] ?? a.defaultValue);
(font as any)._glyphs = {};
const glyph = font.getGlyph(font.glyphForCodePoint(0x50).id)!;
const { minX, minY, maxX, maxY } = glyph.path.bbox;
const gw = maxX - minX;
const gh = maxY - minY;

// Glyph path in a size x size box: bbox-centered, cap height = capFrac*size, then optically nudged.
function glyphPath(size: number, capFrac: number, dx: number, dy: number): string {
  const s = (capFrac * size) / gh;
  const x0 = size / 2 + dx * size - (gw * s) / 2;
  const y0 = size / 2 + dy * size + (gh * s) / 2; // SVG y of the font baseline-side bbox bottom
  return glyph.path.transform(s, 0, 0, -s, x0 - minX * s, y0 + minY * s).toSVG();
}

const svg = (size: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
const circle = (size: number) => `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${DARK}"/>`;

const any = (size: number) =>
  svg(size, `${circle(size)}<path fill="${LIGHT}" d="${glyphPath(size, 0.44, 0.02, -0.015)}"/>`);
const maskable = (size: number) =>
  svg(size, `<rect width="${size}" height="${size}" fill="${DARK}"/><path fill="${LIGHT}" d="${glyphPath(size, 0.36, 0.02, -0.015)}"/>`);
const mono = (size: number) =>
  svg(size, `<path fill="#fff" d="${glyphPath(size, 0.36, 0.02, -0.015)}"/>`);

mkdirSync(OUT, { recursive: true });
mkdirSync('brand', { recursive: true });

const flipped = glyph.path.transform(1, 0, 0, -1, -minX, maxY).toSVG();
writeFileSync('brand/promus-p.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gw} ${gh}"><path d="${flipped}"/></svg>\n`);
writeFileSync(`${OUT}/favicon.svg`, any(512).replace(/ width="512" height="512"/, '') + '\n');

const pngs: [string, number, string][] = [
  ['icon-192.png', 192, any(192)],
  ['icon-512.png', 512, any(512)],
  ['maskable-192.png', 192, maskable(192)],
  ['maskable-512.png', 512, maskable(512)],
  ['monochrome-512.png', 512, mono(512)],
];
for (const [name, size, markup] of pngs) {
  await sharp(Buffer.from(markup)).png().toFile(`${OUT}/${name}`);
  const { width, height } = await sharp(`${OUT}/${name}`).metadata();
  if (width !== size || height !== size) throw new Error(`${name}: expected ${size}x${size}, got ${width}x${height}`);
  console.log(`${name} ${width}x${height}`);
}
