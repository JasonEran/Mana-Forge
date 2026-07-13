# Desktop Client (Frozen Migration Source)

This Electron client is not a supported Mana runtime or release target. It is
retained temporarily as the source for NSIS installer, bundled-Node, and
historical avatar packaging work that may be migrated to `windows-launcher`.

Do not add product features, publish installers, or direct users to this
directory. Use the supported runtime instead:

```text
windows-launcher -> node-bot -> local Whisper / local Llama / Kokoro
```

See `docs/adr/0001-supported-windows-runtime.md` from the repository root for
the decision, lifecycle matrix, migration plan, and rollback trigger.
