const avatarBridge = window.manaAvatar;
const { createLive2dAvatar } = window.ManaLive2dAvatar;

const avatar = document.getElementById("avatar");
const live2dCanvas = document.getElementById("live2d");
const states = {
  idle: "../assets/avatar/idle.png",
  talking: "../assets/avatar/talking.png",
  excited: "../assets/avatar/talking.png",
  angry: "../assets/avatar/talking.png",
  sad: "../assets/avatar/talking.png",
  disgusted: "../assets/avatar/talking.png",
};

let live2dAvatar = null;
let currentState = "idle";

function setAvatarState(state) {
  const nextState = states[state] ? state : "idle";
  currentState = nextState;
  document.body.dataset.state = nextState;
  avatar.src = states[nextState];
  if (live2dAvatar) {
    live2dAvatar.setState(nextState);
  }
}

avatarBridge.onState((state) => {
  setAvatarState(state);
});

// Speech amplitude from the main window (0..1-ish RMS) drives the mouth.
avatarBridge.onMouth((rms) => {
  if (live2dAvatar) {
    live2dAvatar.setMouthTarget(rms);
  }
});

setAvatarState("idle");

avatarBridge
  .getBootstrap()
  .then((bootstrap) =>
    createLive2dAvatar({
      canvas: live2dCanvas,
      width: window.innerWidth,
      height: window.innerHeight,
      bootstrap,
    }),
  )
  .then((instance) => {
    if (instance) {
      live2dAvatar = instance;
      document.body.dataset.renderer = "live2d";
      live2dAvatar.setState(currentState);
    }
  })
  .catch((error) => {
    console.warn("Live2D avatar failed to load; using local static avatar:", error);
    document.body.dataset.renderer = "static";
  });
