import { mkdirSync, writeFileSync } from 'node:fs';
import { openSync, type Font } from 'fontkit';
import sharp from 'sharp';

const FONT = 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2';
const OUT = 'apps/web/public/icons';
const DARK = '#354E16';
const LIGHT = '#CDEDA3';

type Axes = Record<string, number>;
const WANTED: Axes = { wght: 700, SOFT: 100, WONK: 1, opsz: 144 };

// Workaround for fontkit 2.0.4 + WOFF2 (three separate problems):
// - getVariation() re-decodes the compressed bytes and fails, so we vary the font in place;
// - `_variationProcessor` is cached as a non-configurable own property (null, once the glyf table is
//   decoded without variation), so a derived object computes its own;
// - WOFF2 glyphs are pre-decoded without variation and never varied afterwards, so we apply the
//   processor's deltas to the P's points ourselves, before the path is first read.
// Each call opens its own font, because that mutates the shared decoded points.
function pGlyph(axes: Axes) {
  const base = openSync(FONT) as Font;
  base.getGlyph(0); // decode the glyf table while no variation is active
  const font = Object.create(base) as any;
  font.variationCoords = base.fvar.axis.map((a: any) => axes[a.axisTag.trim()] ?? a.defaultValue);
  font._glyphs = {};
  let proto = Object.getPrototypeOf(base);
  while (!Object.getOwnPropertyDescriptor(proto, '_variationProcessor')) proto = Object.getPrototypeOf(proto);
  const processor = Object.getOwnPropertyDescriptor(proto, '_variationProcessor')!.get!.call(font);
  if (!processor) throw new Error('fontkit variation processor is null; variation not applied');
  const glyph = font.getGlyph(font.glyphForCodePoint(0x50).id);
  const decoded = glyph._decode();
  const Point = decoded.points[0].constructor;
  const phantoms = [0, 1, 2, 3].map(() => new Point(false, true, 0, 0));
  processor.transformPoints(glyph.id, [...decoded.points, ...phantoms]);
  return glyph;
}

const glyph = pGlyph(WANTED);
const bbox = (g: { path: { bbox: object } }) => JSON.stringify(g.path.bbox);
if (bbox(glyph) === bbox(pGlyph({}))) throw new Error('P bbox equals the default master; variation not applied');
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

const roundIcon = (size: number) =>
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
writeFileSync(`${OUT}/favicon.svg`, roundIcon(512).replace(/ width="512" height="512"/, '') + '\n');

const pngs: [string, number, string][] = [
  ['icon-192.png', 192, roundIcon(192)],
  ['icon-512.png', 512, roundIcon(512)],
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
