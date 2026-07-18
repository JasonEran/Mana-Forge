# Desktop Client (Frozen Historical Source)

This Electron client is not a supported Mana runtime or release target. It is
retained temporarily for the Issue #9 archive review. Its NSIS and bundled-Node
design has migrated to `windows-launcher` and is no longer owned here.

Do not add product features, publish installers, or direct users to this
directory. Use the supported runtime instead:

```text
windows-launcher -> node-bot -> local Whisper / local Llama / Kokoro
```

See `docs/adr/0001-supported-windows-runtime.md` from the repository root for
the decision, lifecycle matrix, migration plan, and rollback trigger.
