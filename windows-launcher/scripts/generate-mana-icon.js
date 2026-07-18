const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const {
  ACTIVE_COLOR,
  BAR_COUNT,
  IDLE_COLOR,
  getFrameSnapshot,
} = require("../avatar/ring-visualizer");

const ICON_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Object.freeze(
  Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  }),
);

function parseHexColor(value, alpha = 255) {
  const match = String(value).match(/^#([0-9a-f]{6})$/i);
  assert.ok(match, `Invalid RGB color: ${value}`);
  const number = Number.parseInt(match[1], 16);
  return {
    red: (number >>> 16) & 0xff,
    green: (number >>> 8) & 0xff,
    blue: number & 0xff,
    alpha,
  };
}

function mixColors(first, second, amount, alpha = 255) {
  const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
  return {
    red: Math.round(first.red + (second.red - first.red) * ratio),
    green: Math.round(first.green + (second.green - first.green) * ratio),
    blue: Math.round(first.blue + (second.blue - first.blue) * ratio),
    alpha,
  };
}

function blendPixel(pixels, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size || color.alpha <= 0) return;
  const offset = (y * size + x) * 4;
  const sourceAlpha = color.alpha / 255;
  const destinationAlpha = pixels[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const source = [color.red, color.green, color.blue][channel];
    const destination = pixels[offset + channel];
    pixels[offset + channel] = Math.round(
      (source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) /
        outputAlpha,
    );
  }
  pixels[offset + 3] = Math.round(outputAlpha * 255);
}

function fillCircle(pixels, size, centerX, centerY, radius, color) {
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(size - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(size - 1, Math.ceil(centerY + radius));
  const radiusSquared = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      if (dx * dx + dy * dy <= radiusSquared) {
        blendPixel(pixels, size, x, y, color);
      }
    }
  }
}

function fillRotatedRect(pixels, size, centerX, centerY, width, height, angle, color) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const radius = Math.hypot(width, height) / 2;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(size - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(size - 1, Math.ceil(centerY + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      const localX = dx * cosine + dy * sine;
      const localY = -dx * sine + dy * cosine;
      if (Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2) {
        blendPixel(pixels, size, x, y, color);
      }
    }
  }
}

function downsampleRgba(source, sourceSize, targetSize) {
  assert.equal(sourceSize % targetSize, 0, "Icon supersampling ratio must be integral");
  const scale = sourceSize / targetSize;
  const target = Buffer.alloc(targetSize * targetSize * 4);
  for (let targetY = 0; targetY < targetSize; targetY += 1) {
    for (let targetX = 0; targetX < targetSize; targetX += 1) {
      let alphaSum = 0;
      const premultiplied = [0, 0, 0];
      for (let sampleY = 0; sampleY < scale; sampleY += 1) {
        for (let sampleX = 0; sampleX < scale; sampleX += 1) {
          const sourceX = targetX * scale + sampleX;
          const sourceY = targetY * scale + sampleY;
          const sourceOffset = (sourceY * sourceSize + sourceX) * 4;
          const alpha = source[sourceOffset + 3];
          alphaSum += alpha;
          for (let channel = 0; channel < 3; channel += 1) {
            premultiplied[channel] += source[sourceOffset + channel] * alpha;
          }
        }
      }
      const sampleCount = scale * scale;
      const targetOffset = (targetY * targetSize + targetX) * 4;
      const averageAlpha = Math.round(alphaSum / sampleCount);
      for (let channel = 0; channel < 3; channel += 1) {
        target[targetOffset + channel] = alphaSum
          ? Math.round(premultiplied[channel] / alphaSum)
          : 0;
      }
      target[targetOffset + 3] = averageAlpha;
    }
  }
  return target;
}

function renderManaIcon(size, supersample = 4) {
  assert.ok(Number.isInteger(size) && size >= 16 && size <= 256, "Invalid icon size");
  const renderSize = size * supersample;
  const pixels = Buffer.alloc(renderSize * renderSize * 4);
  const center = renderSize / 2;
  const active = parseHexColor(ACTIVE_COLOR);
  const idle = parseHexColor(IDLE_COLOR);
  const backgroundEdge = parseHexColor("#25483b", 250);
  const background = parseHexColor("#0d1d17", 250);
  const frame = getFrameSnapshot({
    timeMs: 2_150,
    state: "talking",
    energy: 0.42,
  });

  fillCircle(pixels, renderSize, center, center, renderSize * 0.47, backgroundEdge);
  fillCircle(pixels, renderSize, center, center, renderSize * 0.445, background);

  const innerRadius = renderSize * 0.245;
  const minLength = renderSize * 0.09;
  const lengthRange = renderSize * 0.135;
  const barWidth = Math.max(supersample, renderSize * 0.026);
  const barCenters = [];
  for (let index = 0; index < frame.bars.length; index += 1) {
    const bar = frame.bars[index];
    const angle = bar.angle + frame.rotation;
    const length = minLength + lengthRange * bar.length;
    const radius = innerRadius + length / 2;
    const centerX = center + Math.sin(angle) * radius;
    const centerY = center - Math.cos(angle) * radius;
    const color = mixColors(active, idle, 0.08 + bar.wave * 0.3);
    fillRotatedRect(
      pixels,
      renderSize,
      centerX,
      centerY,
      barWidth * 1.85,
      length * 1.08,
      angle,
      { ...active, alpha: 42 },
    );
    fillRotatedRect(
      pixels,
      renderSize,
      centerX,
      centerY,
      barWidth,
      length,
      angle,
      color,
    );
    barCenters.push({
      x: centerX / supersample,
      y: centerY / supersample,
    });
  }

  fillCircle(pixels, renderSize, center, center, renderSize * 0.057, {
    ...active,
    alpha: 70,
  });
  fillCircle(pixels, renderSize, center, center, renderSize * 0.029, idle);

  return {
    barCenters: Object.freeze(barCenters),
    frame,
    rgba: downsampleRgba(pixels, renderSize, size),
    size,
  };
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function encodePng(width, height, rgba) {
  assert.equal(rgba.length, width * height * 4, "RGBA size does not match PNG dimensions");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createIco(images) {
  assert.ok(images.length > 0, "ICO requires at least one image");
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = headerSize;
  images.forEach((image, index) => {
    const entryOffset = 6 + index * 16;
    header[entryOffset] = image.size === 256 ? 0 : image.size;
    header[entryOffset + 1] = image.size === 256 ? 0 : image.size;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.png.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

function parseIco(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, "ICO reserved field must be zero");
  assert.equal(buffer.readUInt16LE(2), 1, "ICO type must be icon");
  const count = buffer.readUInt16LE(4);
  assert.ok(count > 0, "ICO contains no images");
  return Array.from({ length: count }, (_, index) => {
    const entryOffset = 6 + index * 16;
    const width = buffer[entryOffset] || 256;
    const height = buffer[entryOffset + 1] || 256;
    const byteLength = buffer.readUInt32LE(entryOffset + 8);
    const imageOffset = buffer.readUInt32LE(entryOffset + 12);
    const png = buffer.subarray(imageOffset, imageOffset + byteLength);
    assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.equal(png.readUInt32BE(16), width, "ICO and PNG widths differ");
    assert.equal(png.readUInt32BE(20), height, "ICO and PNG heights differ");
    return { bitCount: buffer.readUInt16LE(entryOffset + 6), height, png, width };
  });
}

function generateManaIcon(sizes = ICON_SIZES) {
  const images = sizes.map((size) => {
    const rendered = renderManaIcon(size);
    return { ...rendered, png: encodePng(size, size, rendered.rgba) };
  });
  return { buffer: createIco(images), images };
}

function writeManaIcon(outputPath = path.resolve(__dirname, "..", "build", "icon.ico")) {
  const generated = generateManaIcon();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, generated.buffer);
  return {
    bytes: generated.buffer.length,
    outputPath,
    sha256: crypto.createHash("sha256").update(generated.buffer).digest("hex"),
    sizes: [...ICON_SIZES],
  };
}

function main() {
  const result = writeManaIcon(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  process.stdout.write(`${JSON.stringify({ ...result, outputPath: path.relative(process.cwd(), result.outputPath) })}\n`);
}

if (require.main === module) main();

module.exports = {
  ICON_SIZES,
  createIco,
  encodePng,
  generateManaIcon,
  parseIco,
  renderManaIcon,
  writeManaIcon,
};
