const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { app, BrowserWindow, net, protocol } = require("electron");
const {
  APP_ORIGIN,
  installLocalProtocols,
  registerPrivilegedSchemes,
} = require("../local-protocol");

registerPrivilegedSchemes(protocol);
app.setPath("userData", path.join(os.tmpdir(), `mana-avatar-smoke-${process.pid}`));

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function inspectBitmap(image) {
  const bitmap = image.toBitmap();
  let visiblePixels = 0;
  let whitePixels = 0;
  let greenPixels = 0;
  for (let index = 0; index < bitmap.length; index += 4) {
    const blue = bitmap[index];
    const green = bitmap[index + 1];
    const red = bitmap[index + 2];
    const alpha = bitmap[index + 3];
    if (alpha > 20 && Math.max(red, green, blue) > 20) visiblePixels += 1;
    if (
      alpha > 50 &&
      red > 120 &&
      green > 120 &&
      blue > 120 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) < 18
    ) {
      whitePixels += 1;
    }
    if (alpha > 50 && green > red + 20 && green > blue + 10) greenPixels += 1;
  }
  return { greenPixels, visiblePixels, whitePixels };
}

async function capture(window, name) {
  const image = await window.webContents.capturePage();
  const evidenceDirectory = process.env.MANA_VISUAL_EVIDENCE_DIR;
  if (evidenceDirectory) {
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    fs.writeFileSync(path.join(evidenceDirectory, `${name}.png`), image.toPNG());
  }
  return inspectBitmap(image);
}

app.whenReady()
  .then(async () => {
    const root = path.resolve(__dirname, "..");
    installLocalProtocols({ protocol, net, appRoot: root });
    const window = new BrowserWindow({
      width: 234,
      height: 288,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(root, "avatar-preload.js"),
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    await window.loadURL(`${APP_ORIGIN}/avatar/index.html`);
    await wait(180);
    const idle = await capture(window, "mana-ring-idle");
    window.webContents.send("avatar:state", "talking");
    window.webContents.send("avatar:mouth", 0.8);
    await wait(180);
    const active = await capture(window, "mana-ring-active");

    assert.ok(
      idle.visiblePixels > 250,
      `idle ring is blank: ${JSON.stringify(idle)}`,
    );
    assert.ok(
      idle.whitePixels > 150,
      `idle ring does not render white bars: ${JSON.stringify(idle)}`,
    );
    assert.ok(
      active.visiblePixels > 250,
      `active ring is blank: ${JSON.stringify(active)}`,
    );
    assert.ok(
      active.greenPixels > 150,
      `active ring does not render pale-green bars: ${JSON.stringify(active)}`,
    );

    process.stdout.write(`${JSON.stringify({ active, idle, size: window.getContentSize() })}\n`);
    window.destroy();
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
