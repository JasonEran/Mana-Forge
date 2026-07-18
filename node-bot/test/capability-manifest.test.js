const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CAPABILITY_DEFINITIONS,
  OPTIONAL_CAPABILITIES,
  isCapabilityEnabled,
  resolveCapabilityManifest,
} = require("../capabilities/manifest");

test("Core is the default profile and every optional capability is disabled", () => {
  const manifest = resolveCapabilityManifest({});

  assert.equal(manifest.profile, "core");
  assert.equal(manifest.capabilities.localApi.status, "available");
  for (const capability of OPTIONAL_CAPABILITIES) {
    assert.equal(manifest.capabilities[capability.key].enabled, false);
    assert.equal(manifest.capabilities[capability.key].status, "disabled");
  }
});

test("optional capabilities require their flag or an explicit Full profile", () => {
  assert.equal(isCapabilityEnabled("retrieval", {}), false);
  assert.equal(
    isCapabilityEnabled("retrieval", { MANA_RETRIEVAL_ENABLED: "1" }),
    true,
  );
  assert.equal(
    isCapabilityEnabled("retrieval", {
      MANA_PROFILE: "full",
      MANA_RETRIEVAL_ENABLED: "0",
    }),
    true,
  );

  const full = resolveCapabilityManifest({ MANA_PROFILE: "full" });
  assert.equal(full.profile, "full");
  assert.equal(full.capabilities.retrieval.status, "configured");
});

test("each capability declares ownership, dependencies, health, and uninstall behavior", () => {
  for (const capability of CAPABILITY_DEFINITIONS) {
    assert.match(capability.owner, /\S/);
    assert.ok(Array.isArray(capability.dependencies));
    assert.ok(Array.isArray(capability.processes));
    assert.ok(Array.isArray(capability.ports));
    assert.match(capability.health, /\S/);
    assert.match(capability.uninstall, /\S/);
    if (capability.profile === "optional") {
      assert.match(capability.flag, /^MANA_[A-Z0-9_]+_ENABLED$/);
    }
  }
});

test("published capability definitions are immutable", () => {
  assert.equal(Object.isFrozen(CAPABILITY_DEFINITIONS), true);
  assert.equal(Object.isFrozen(CAPABILITY_DEFINITIONS[0]), true);
});
