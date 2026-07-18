# Procedural Mana Ring

Mana's supported desktop identity is generated at runtime by
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

## Validation

Run the launcher tests from `windows-launcher`:

```powershell
npm test
npm run test:electron-security
npm run pack
npm run verify:package
```

`test/ring-visualizer.test.js` covers the bar count, deterministic motion,
idle/active palette, energy clamping, and reduced-motion behavior.
`test/artwork-boundary.test.js` prevents avatar artwork and model runtime
dependencies from returning to supported or frozen desktop paths.
