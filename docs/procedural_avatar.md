# Mana Forge Procedural Ring

Mana Forge's supported desktop identity is generated at runtime by
`windows-launcher/avatar/ring-visualizer.js`. It has no raster art, vector
art, character model, remote resource, or rendering-library dependency.

## Visual Contract

- The ring always contains exactly 32 radial bars.
- Idle bars are white. The ring rotates slowly, breathes as a whole, and each
  bar changes length through deterministic layered oscillation.
- Talking and emotion states turn the ring pale green (`#a7f3d0`). A traveling
  energy wave moves around the bars while speech RMS adds amplitude and an
  outward pulse.
- Excited, angry, sad, and disgusted states vary only motion timing and wave
  shape. The identity stays within the white/pale-green palette.
- Reduced-motion preference disables rotation and time-varying bar movement.

The same module renders the transparent overlay and the avatar dock in the
main Electron window. State and RMS values cross the existing narrow preload
bridges; the renderer does not receive filesystem or raw Electron access.

## Windows Application Icon

`windows-launcher/scripts/generate-mana-icon.js` reuses the same fixed seed,
32-bar frame, idle white, and active pale-green constants to rasterize the
Windows application identity. It uses only Node.js built-ins and repository
source. No downloaded, generated-by-service, or separately licensed artwork is
an input.

Before `npm run pack` or `npm run dist`, the release-input check writes a
deterministic multi-size ICO to `windows-launcher/build/icon.ico`. The binary
contains 16, 24, 32, 48, 64, 128, and 256 pixel 32-bit PNG layers. It is a
git-ignored build input; the generator and tests are the source of record.

Electron Builder keeps Windows resource editing enabled so the application and
NSIS installer receive this icon and version metadata, while
`signExecutable: false` independently keeps Authenticode signing disabled.
`npm run verify:branding` parses the resulting PE resources and requires every
source icon layer to be embedded unchanged.

## Validation

Run the launcher tests from `windows-launcher`:

```powershell
npm test
npm run test:electron-security
npm run pack
npm run verify:package
npm run verify:branding
```

`test/ring-visualizer.test.js` covers the bar count, deterministic motion,
idle/active palette, energy clamping, and reduced-motion behavior.
`test/artwork-boundary.test.js` prevents avatar artwork and model runtime
dependencies from returning to supported or frozen desktop paths.
`test/app-icon.test.js` covers deterministic ICO construction, every Windows
size, 32-bar rasterization, transparent/pale-green/white pixels, and ignored
build-input ownership.
