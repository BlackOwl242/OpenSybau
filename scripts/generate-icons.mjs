import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Build dense polygon approximation of the exact SVG path for the Golden-Ratio S shape
function buildSPathPolygon(stepsPerCurve = 24) {
  const pts = [];
  const pushLine = (x0, y0, x1, y1) => {
    pts.push([x0, y0], [x1, y1]);
  };
  const pushCubic = (x0, y0, x1, y1, x2, y2, x3, y3) => {
    for (let i = 0; i <= stepsPerCurve; i++) {
      const t = i / stepsPerCurve;
      const u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      pts.push([x, y]);
    }
  };

  // Exact match to:
  // M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39V24.2Z
  pushCubic(29.8, 24.2, 29.8, 23.45, 30.22, 22.76, 30.89, 22.43);
  pushLine(30.89, 22.43, 48.72, 13.51);
  pushCubic(48.72, 13.51, 49.91, 12.92, 51.2, 13.78, 51.2, 15.11);
  pushLine(51.2, 15.11, 51.2, 24.9);
  pushCubic(51.2, 24.9, 51.2, 25.65, 50.78, 26.34, 50.11, 26.67);
  pushLine(50.11, 26.67, 35.09, 34.18);
  pushCubic(35.09, 34.18, 34.55, 34.45, 34.2, 35.0, 34.2, 35.61);
  pushLine(34.2, 35.61, 34.2, 39.8);
  pushCubic(34.2, 39.8, 34.2, 40.55, 33.78, 41.24, 33.11, 41.57);
  pushLine(33.11, 41.57, 15.28, 50.49);
  pushCubic(15.28, 50.49, 14.09, 51.08, 12.8, 50.22, 12.8, 48.89);
  pushLine(12.8, 48.89, 12.8, 39.1);
  pushCubic(12.8, 39.1, 12.8, 38.35, 13.22, 37.66, 13.89, 37.33);
  pushLine(13.89, 37.33, 28.91, 29.82);
  pushCubic(28.91, 29.82, 29.45, 29.55, 29.8, 29.0, 29.8, 28.39);
  pushLine(29.8, 28.39, 29.8, 24.2);
  return pts;
}

const sPolygon = buildSPathPolygon(28);

// Signed distance to polygon (negative inside, positive outside)
function sdPolygon(px, py, poly) {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const ex = xj - xi;
    const ey = yj - yi;
    const wx = px - xi;
    const wy = py - yi;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / len2)) : 0;
    const dx = wx - ex * t;
    const dy = wy - ey * t;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < d) d = dist2;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return (inside ? -1 : 1) * Math.sqrt(d);
}

function sdRoundedBox(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inn = Math.min(Math.max(qx, qy), 0);
  return out + inn - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function smoothCoverage(sd, pixelSize) {
  const half = pixelSize * 0.55;
  if (sd <= -half) return 1;
  if (sd >= half) return 0;
  const t = (sd + half) / (2 * half);
  return 1 - t * t * (3 - 2 * t);
}

function renderIconRGBA(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = 64 / size;
  // Background: #F5F0EB -> (245, 240, 235)
  const bgR = 245, bgG = 240, bgB = 235;

  for (let y = 0; y < size; y++) {
    const py = (y + 0.5) * scale;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) * scale;
      const idx = (y * size + x) * 4;

      const dBg = sdRoundedBox(px, py, 32, 32, 32, 32, 15);
      const covBg = smoothCoverage(dBg, scale);
      if (covBg <= 0) {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
        continue;
      }

      const dC1 = sdCircle(px, py, 19.6, 19.8, 6.8);
      const dC2 = sdCircle(px, py, 44.4, 44.2, 6.8);
      let dFg = Math.min(dC1, dC2);
      // Bounding box pre-check for S polygon [12.8..51.2]
      if (px >= 11 && px <= 53 && py >= 11 && py <= 53) {
        const dS = sdPolygon(px, py, sPolygon);
        if (dS < dFg) dFg = dS;
      }

      const covFg = smoothCoverage(dFg, scale);
      // Blend foreground #000000 over background #F5F0EB
      const invFg = 1 - covFg;
      rgba[idx] = Math.round(bgR * invFg);
      rgba[idx + 1] = Math.round(bgG * invFg);
      rgba[idx + 2] = Math.round(bgB * invFg);
      rgba[idx + 3] = Math.round(covBg * 255);
    }
  }
  return rgba;
}

// Minimal CRC32 table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeICO(pngBuffersWithSizes) {
  const count = pngBuffersWithSizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;
  for (const { size, png } of pngBuffersWithSizes) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...dirEntries, ...pngBuffersWithSizes.map((item) => item.png)]);
}

const sizes = [16, 32, 48, 64, 128, 180, 192, 256, 512];
const renderedPngs = new Map();
for (const size of sizes) {
  const rgba = renderIconRGBA(size);
  renderedPngs.set(size, encodePNG(size, size, rgba));
}

mkdirSync(path.join(rootDir, "public"), { recursive: true });
mkdirSync(path.join(rootDir, "desktop"), { recursive: true });

// Web & PWA & GitHub icons
writeFileSync(path.join(rootDir, "public", "icon-192.png"), renderedPngs.get(192));
writeFileSync(path.join(rootDir, "public", "icon-512.png"), renderedPngs.get(512));
writeFileSync(path.join(rootDir, "public", "apple-touch-icon.png"), renderedPngs.get(180));
writeFileSync(
  path.join(rootDir, "public", "favicon.ico"),
  encodeICO([16, 32, 48].map((size) => ({ size, png: renderedPngs.get(size) }))),
);

// Windows Desktop (.exe / Electron / NSIS) icons
writeFileSync(path.join(rootDir, "desktop", "icon.png"), renderedPngs.get(512));
writeFileSync(
  path.join(rootDir, "desktop", "icon.ico"),
  encodeICO([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: renderedPngs.get(size) }))),
);

console.log("Generated web, desktop (.exe/.ico), and GitHub icons successfully.");
