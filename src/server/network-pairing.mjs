import { networkInterfaces, hostname as osHostname } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * Discover non-internal IPv4 network addresses (LAN Wi-Fi/Ethernet, Tailscale 100.x, WireGuard).
 */
export function discoverLanAddresses(port = 4173, protocol = "http") {
  const nets = networkInterfaces();
  const list = [];
  for (const [name, entries] of Object.entries(nets || {})) {
    for (const entry of entries || []) {
      const family = String(entry.family || "");
      if ((family !== "IPv4" && family !== "4") || entry.internal) continue;
      const address = String(entry.address || "").trim();
      if (!address || address.startsWith("169.254.")) continue;
      const isTailscale = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) || /tailscale|utun|wg/i.test(name);
      const isPrivateLan = /^(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address);
      const kind = isTailscale ? "tailscale" : isPrivateLan ? "lan" : "public";
      list.push({
        interface: name,
        address,
        kind,
        label: isTailscale ? `Tailscale (${name})` : isPrivateLan ? `Mạng LAN (${name})` : name,
        hostPort: `${address}:${port}`,
        url: `${protocol}://${address}:${port}`,
      });
    }
  }
  return list.sort((a, b) => {
    const score = (item) => (item.kind === "lan" ? 0 : item.kind === "tailscale" ? 1 : 2);
    return score(a) - score(b);
  });
}

export function generateStrongAccessPassword() {
  return randomBytes(18).toString("base64url");
}

// ============================================================================
// Pure-JS ISO/IEC 18004 QR Code SVG Generator (Byte Mode, ECC Level L, Versions 1..10)
// ============================================================================
const QR_VERSIONS = [
  null,
  { total: 26, ec: 7, align: [] },
  { total: 44, ec: 10, align: [6, 18] },
  { total: 70, ec: 15, align: [6, 22] },
  { total: 100, ec: 20, align: [6, 26] },
  { total: 134, ec: 26, align: [6, 30] },
  { total: 172, ec: 18, blocks: 2, align: [6, 34] },
  { total: 196, ec: 20, blocks: 2, align: [6, 22, 38] },
  { total: 242, ec: 24, blocks: 2, align: [6, 24, 42] },
  { total: 292, ec: 30, blocks: 2, align: [6, 26, 46] },
  { total: 346, ec: 18, blocks: 4, align: [6, 28, 50] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

function bchFormatBits(mask) {
  // ECC Level L = 01
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function bchVersionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

export function generateQrCodeSvg(text, { size = 188, margin = 2 } = {}) {
  const bytes = Buffer.from(String(text || ""), "utf8");
  let version = 1;
  while (version <= 10) {
    const spec = QR_VERSIONS[version];
    const blocks = spec.blocks || 1;
    const dataCap = spec.total - spec.ec * blocks;
    const headerBits = version <= 9 ? 4 + 8 : 4 + 16;
    if (Math.ceil((headerBits + bytes.length * 8) / 8) <= dataCap) break;
    version++;
  }
  if (version > 10) return "";
  const spec = QR_VERSIONS[version];
  const blocks = spec.blocks || 1;
  const totalEc = spec.ec * blocks;
  const dataBytesLen = spec.total - totalEc;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  for (let i = 0; i < 4 && bits.length < dataBytesLen * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = new Uint8Array(dataBytesLen);
  for (let i = 0; i < bits.length / 8; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) val = (val << 1) | bits[i * 8 + b];
    codewords[i] = val;
  }
  for (let i = bits.length / 8, pad = 0; i < dataBytesLen; i++, pad++) {
    codewords[i] = pad % 2 === 0 ? 0xec : 0x11;
  }

  const dataBlocks = [];
  const ecBlocks = [];
  const shortBlockLen = Math.floor(dataBytesLen / blocks);
  const numLongBlocks = dataBytesLen % blocks;
  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const len = shortBlockLen + (b >= blocks - numLongBlocks ? 1 : 0);
    const blockData = codewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(blockData);
    ecBlocks.push(rsEncode(blockData, spec.ec));
  }

  const finalBytes = [];
  const maxDataLen = shortBlockLen + (numLongBlocks > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < blocks; b++) {
      if (i < dataBlocks[b].length) finalBytes.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < spec.ec; i++) {
    for (let b = 0; b < blocks; b++) {
      finalBytes.push(ecBlocks[b][i]);
    }
  }

  const dim = 17 + version * 4;
  const grid = Array.from({ length: dim }, () => new Int8Array(dim));
  const reserved = Array.from({ length: dim }, () => new Uint8Array(dim));

  const setModule = (r, c, val, isFunc = true) => {
    if (r < 0 || r >= dim || c < 0 || c >= dim) return;
    grid[r][c] = val ? 1 : 0;
    if (isFunc) reserved[r][c] = 1;
  };

  const drawFinder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setModule(r0 + r, c0 + c, inOuter && (onBorder || inInner), true);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, dim - 7);
  drawFinder(dim - 7, 0);

  for (let i = 8; i < dim - 8; i++) {
    setModule(6, i, i % 2 === 0, true);
    setModule(i, 6, i % 2 === 0, true);
  }

  const align = spec.align;
  for (const r0 of align) {
    for (const c0 of align) {
      if ((r0 < 9 && c0 < 9) || (r0 < 9 && c0 > dim - 10) || (r0 > dim - 10 && c0 < 9)) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          setModule(r0 + r, c0 + c, dark, true);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = 1;
    reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][dim - 1 - i] = 1;
    reserved[dim - 1 - i][8] = 1;
  }
  setModule(dim - 8, 8, 1, true);

  if (version >= 7) {
    const vbits = bchVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (vbits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + dim - 11;
      setModule(a, b, bit, true);
      setModule(b, a, bit, true);
    }
  }

  let bitIdx = 0;
  const totalBits = finalBytes.length * 8;
  let upward = true;
  for (let col = dim - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < dim; step++) {
      const r = upward ? dim - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (reserved[r][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (finalBytes[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        // Mask 0: (r + c) % 2 === 0
        if ((r + c) % 2 === 0) bit ^= 1;
        grid[r][c] = bit;
      }
    }
    upward = !upward;
  }

  const fbits = bchFormatBits(0);
  for (let i = 0; i <= 5; i++) setModule(8, i, (fbits >> i) & 1, true);
  setModule(8, 7, (fbits >> 6) & 1, true);
  setModule(8, 8, (fbits >> 7) & 1, true);
  setModule(7, 8, (fbits >> 8) & 1, true);
  for (let i = 9; i < 15; i++) setModule(14 - i, 8, (fbits >> i) & 1, true);
  for (let i = 0; i < 8; i++) setModule(dim - 1 - i, 8, (fbits >> i) & 1, true);
  for (let i = 8; i < 15; i++) setModule(8, dim - 15 + i, (fbits >> i) & 1, true);

  const viewBoxSize = dim + margin * 2;
  let pathData = "";
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      if (grid[r][c]) pathData += `M${c + margin},${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="100%" height="100%" rx="1.5" fill="#ffffff"/><path d="${pathData}" fill="#09090b"/></svg>`;
}

export function buildConnectionInfoPayload({
  host,
  port,
  protocol = "http",
  isLoopbackBind = true,
  productionMode = false,
  accessUsername = "opensybau",
  hasAccessPassword = false,
  allowedHosts = [],
  version = "0.2.101",
  connectors = {},
  activeWorktreesCount = 0,
  runningTasksCount = 0,
} = {}) {
  const lanAddresses = discoverLanAddresses(port, protocol);
  const primaryLan = lanAddresses[0] || null;
  const primaryUrl = !isLoopbackBind && primaryLan
    ? primaryLan.url
    : primaryLan
      ? primaryLan.url
      : `${protocol}://127.0.0.1:${port}`;
  const suggestedPassword = generateStrongAccessPassword();
  const allowedHostList = lanAddresses.length
    ? lanAddresses.map((item) => item.hostPort).join(",")
    : `192.168.1.20:${port}`;

  const pairingPayload = {
    v: 1,
    name: osHostname() || "OpenSybau-PC",
    url: primaryUrl,
    user: accessUsername || "opensybau",
    lan: lanAddresses.map((item) => item.url),
  };
  const pairingUri = `opensybau://connect?host=${encodeURIComponent(primaryUrl)}&user=${encodeURIComponent(accessUsername || "opensybau")}&name=${encodeURIComponent(pairingPayload.name)}`;
  const qrSvg = generateQrCodeSvg(pairingUri, { size: 184, margin: 2 });

  const powershellCommand = [
    `$env:WORKBENCH_MODE="production"`,
    `$env:WORKBENCH_HOST="0.0.0.0"`,
    `$env:WORKBENCH_PORT="${port}"`,
    `$env:WORKBENCH_ALLOWED_HOSTS="${allowedHostList}"`,
    `$env:WORKBENCH_ACCESS_USERNAME="${accessUsername || "opensybau"}"`,
    `$env:WORKBENCH_ACCESS_PASSWORD="${suggestedPassword}"`,
    `npm run build; npm start`,
  ].join("; ");

  const bashCommand = [
    `WORKBENCH_MODE=production`,
    `WORKBENCH_HOST=0.0.0.0`,
    `WORKBENCH_PORT=${port}`,
    `WORKBENCH_ALLOWED_HOSTS="${allowedHostList}"`,
    `WORKBENCH_ACCESS_USERNAME="${accessUsername || "opensybau"}"`,
    `WORKBENCH_ACCESS_PASSWORD="${suggestedPassword}"`,
    `npm run build && npm start`,
  ].join(" ");

  return {
    ok: true,
    hostname: osHostname() || "OpenSybau-Host",
    platform: process.platform,
    version,
    host,
    port,
    protocol,
    mode: isLoopbackBind ? "loopback" : "network",
    productionMode: Boolean(productionMode),
    authRequired: Boolean(hasAccessPassword),
    accessUsername: accessUsername || "opensybau",
    allowedHosts: [...allowedHosts],
    lanAddresses,
    primaryUrl,
    pairingUri,
    qrSvg,
    activeWorktreesCount,
    runningTasksCount,
    connectorsSummary: Object.entries(connectors || {}).map(([id, item]) => ({
      id,
      available: Boolean(item?.available),
      modelCount: (item?.models || []).length,
    })),
    launchers: {
      suggestedPassword,
      allowedHostList,
      powershell: powershellCommand,
      bash: bashCommand,
    },
  };
}
