const { spawnSync } = require("node:child_process");
const path = require("node:path");

const electron = require("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const result = spawnSync(
  electron,
  ["--disable-gpu", path.join(__dirname, "electron-security-smoke.js")],
  {
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
