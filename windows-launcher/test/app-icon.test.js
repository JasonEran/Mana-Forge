const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { BAR_COUNT } = require("../avatar/ring-visualizer");
const {
  ICON_SIZES,
  generateManaIcon,
  parseIco,
  renderManaIcon,
  writeManaIcon,
} = require("../scripts/generate-mana-icon");

function pixelAt(rgba, size, x, y) {
  const safeX = Math.max(0, Math.min(size - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(size - 1, Math.round(y)));
  const offset = (safeY * size + safeX) * 4;
  return [...rgba.subarray(offset, offset + 4)];
}

test("generated Mana ICO is deterministic and contains every Windows size", () => {
  const first = generateManaIcon();
  const second = generateManaIcon();
  assert.deepEqual(first.buffer, second.buffer);
  assert.deepEqual(
    parseIco(first.buffer).map((entry) => entry.width),
    ICON_SIZES,
  );
  assert.ok(parseIco(first.buffer).every((entry) => entry.bitCount === 32));
  assert.equal(
    crypto.createHash("sha256").update(first.buffer).digest("hex"),
    crypto.createHash("sha256").update(second.buffer).digest("hex"),
  );
});

test("generated icon rasterizes all 32 bars in the white and pale-green identity", () => {
  const rendered = renderManaIcon(256);
  assert.equal(rendered.frame.bars.length, BAR_COUNT);
  assert.equal(rendered.barCenters.length, BAR_COUNT);
  for (const center of rendered.barCenters) {
    const [red, green, blue, alpha] = pixelAt(rendered.rgba, 256, center.x, center.y);
    assert.ok(alpha > 180, `bar alpha is too low: ${alpha}`);
    assert.ok(green > 150 && red > 120 && blue > 120, `bar color is not pale: ${red},${green},${blue}`);
  }

  let transparentPixels = 0;
  let palePixels = 0;
  let whitePixels = 0;
  for (let offset = 0; offset < rendered.rgba.length; offset += 4) {
    const red = rendered.rgba[offset];
    const green = rendered.rgba[offset + 1];
    const blue = rendered.rgba[offset + 2];
    const alpha = rendered.rgba[offset + 3];
    if (alpha < 10) transparentPixels += 1;
    if (alpha > 180 && green > red + 12 && green > blue + 5) palePixels += 1;
    if (alpha > 180 && red > 225 && green > 225 && blue > 225) whitePixels += 1;
  }
  assert.ok(transparentPixels > 10_000);
  assert.ok(palePixels > 1_000);
  assert.ok(whitePixels > 20);
});

test("icon binary is generated as an ignored build input", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mana-icon-"));
  const outputPath = path.join(tempDir, "icon.ico");
  const result = writeManaIcon(outputPath);
  assert.ok(fs.statSync(outputPath).isFile());
  assert.equal(result.bytes, fs.statSync(outputPath).size);
  assert.deepEqual(result.sizes, ICON_SIZES);
  assert.deepEqual(parseIco(fs.readFileSync(outputPath)).map((entry) => entry.width), ICON_SIZES);
});
