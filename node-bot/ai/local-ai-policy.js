function assertLocalAiPolicy(env = process.env, options = {}) {
  const remoteRequested = String(env.MANA_ALLOW_REMOTE_AI || "").trim() === "1";
  if (remoteRequested && !options.allowRemoteOverride) {
    throw new Error(
      "Remote AI is disabled for the Zed External Agent. Unset MANA_ALLOW_REMOTE_AI or pass an explicit remote override.",
    );
  }

  return {
    remoteAllowed: remoteRequested,
    mode: remoteRequested ? "remote-opt-in" : "local",
  };
}

module.exports = { assertLocalAiPolicy };
