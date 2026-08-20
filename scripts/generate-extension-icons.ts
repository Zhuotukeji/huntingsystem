import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const sizes = [16, 32, 48, 128];

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function icon(size: number) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const corner = size * 0.18;
  const centerX = size * 0.43; const centerY = size * 0.41; const radius = size * 0.22; const stroke = Math.max(1.4, size * 0.065);
  for (let y = 0; y < size; y += 1) {
    pixels[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const edgeX = x < corner ? corner - x : x > size - corner ? x - (size - corner) : 0;
      const edgeY = y < corner ? corner - y : y > size - corner ? y - (size - corner) : 0;
      const inside = edgeX * edgeX + edgeY * edgeY <= corner * corner || edgeX === 0 || edgeY === 0;
      const distance = Math.hypot(x - centerX, y - centerY);
      const ring = Math.abs(distance - radius) <= stroke;
      const handleDistance = Math.abs((y - centerY) - (x - centerX));
      const handle = x > centerX + radius * 0.55 && y > centerY + radius * 0.55 && x < size * 0.8 && y < size * 0.8 && handleDistance < stroke * 1.25;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      const color = ring || handle ? [240, 248, 245] : [36, 95, 84];
      pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = inside ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const outputDirectory = join(process.cwd(), "extension", "icons");
mkdirSync(outputDirectory, { recursive: true });
for (const size of sizes) writeFileSync(join(outputDirectory, `icon${size}.png`), icon(size));
console.log(`Generated extension icons: ${sizes.join(", ")}px`);
