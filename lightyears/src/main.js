import './style.css';

const params = new URLSearchParams(location.search);

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot() {
  if (params.has('debug')) {
    document.getElementById('title').classList.add('hidden');
    const m = await import('./debugView.js');
    m.runDebug(params);
    return;
  }
  if (!webglOk()) {
    document.querySelector('.title-tag').textContent = 'This browser cannot run WebGL, which the game needs. Try a recent Chrome, Safari, or Firefox.';
    document.querySelector('.title-buttons').classList.add('hidden');
    return;
  }
  const { Game } = await import('./game/game.js');
  const { loadSave, hasGame } = await import('./game/save.js');
  const { startStar } = await import('./world/universe.js');
  const game = new Game();
  window.__game = game;
  if (params.has('nodynres')) {
    game.noDynRes = true;
    window.__faunaMod = await import('./game/fauna.js');
  }

  const saved = loadSave();
  const canContinue = hasGame(saved);
  game.saved = saved;
  if (canContinue) {
    game.galaxySeed = saved.galaxySeed ?? 918;
    game.worldTime = saved.worldTime || 0;
  }
  game.loadSystem(canContinue ? saved.starId : startStar(game.galaxySeed).id);
  game.start();

  const cont = document.getElementById('btn-continue');
  const fresh = document.getElementById('btn-new');
  cont.classList.toggle('hidden', !canContinue);
  const controls = document.getElementById('title-controls');
  controls.innerHTML = game.isTouch
    ? 'Left thumb moves or steers. Drag the right side to look. Best in landscape with sound on.'
    : 'WASD and mouse. Click to capture the mouse, Esc for the menu. Sound on recommended.';

  // on Android, going full screen hides the browser bars; iOS ignores this
  const goFull = () => {
    if (!game.isTouch || document.fullscreenElement || !document.fullscreenEnabled) return;
    try { document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch { /* not supported */ }
  };

  let confirmNew = false;
  cont.addEventListener('click', () => {
    goFull();
    game.audio.start();
    game.continueGame();
  });
  fresh.addEventListener('click', () => {
    if (hasGame(loadSave()) && !confirmNew) {
      confirmNew = true;
      fresh.textContent = 'Tap again to start over';
      setTimeout(() => { confirmNew = false; fresh.textContent = 'Begin a New Journey'; }, 3500);
      return;
    }
    goFull();
    game.audio.start();
    game.newGame();
  });

  if (params.has('autostart')) {
    setTimeout(() => (params.get('autostart') === 'continue' ? game.continueGame() : game.newGame()), 50);
  }
}

boot().catch((err) => {
  console.error(err);
  const t = document.querySelector('.title-tag');
  if (t) t.textContent = `Something went wrong starting the game: ${err.message}`;
});
