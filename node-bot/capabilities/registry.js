function requireCapabilityKey(capability) {
  const key = String(capability?.key || "").trim();
  if (!key) {
    throw new Error("capability key is required");
  }
  return key;
}

function getRegistrationState(context, key) {
  return context?.capabilityManifest?.capabilities?.[key] || null;
}

function disabledHealth(state, key) {
  return {
    status: "disabled",
    configured: false,
    enabled: false,
    message: `${state?.label || key} is disabled.`,
  };
}

function registerCapabilities(app, capabilities = [], context = {}) {
  for (const capability of capabilities) {
    const key = requireCapabilityKey(capability);
    const state = getRegistrationState(context, key);
    if (state && !state.enabled) continue;
    if (typeof capability.registerRoutes === "function") {
      capability.registerRoutes(app, context);
    }
  }
}

function buildCapabilityHealth(capabilities = [], context = {}) {
  const components = {};
  for (const capability of capabilities) {
    const key = requireCapabilityKey(capability);
    const state = getRegistrationState(context, key);
    if (state && !state.enabled) {
      components[key] = disabledHealth(state, key);
      continue;
    }
    if (typeof capability.getHealth === "function") {
      components[key] = {
        enabled: true,
        ...capability.getHealth(context),
      };
    }
  }
  return components;
}

module.exports = {
  buildCapabilityHealth,
  disabledHealth,
  registerCapabilities,
};
