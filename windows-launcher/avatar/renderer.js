const avatarBridge = window.manaAvatar;
const { createManaRing } = window.ManaRingVisualizer;

const ring = createManaRing({
  canvas: document.getElementById("manaRing"),
  initialState: "idle",
});

avatarBridge.onState((state) => ring.setState(state));
avatarBridge.onMouth((rms) => ring.setEnergy(rms));

window.addEventListener("beforeunload", () => ring.destroy(), { once: true });
