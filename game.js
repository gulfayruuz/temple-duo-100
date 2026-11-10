/* Игровой цикл, управление, столкновения и интерфейс. */
const byId = (id) => document.getElementById(id);
const canvas = byId('board');
const context = canvas.getContext('2d');
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const COLORS = ['#ff8455', '#73deff', '#b5e952'];
const LEVEL_COUNT = 100;
const STORAGE_KEY = 'temple-duo-v1';

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

const saved = loadProgress();
const best = saved.best || {};
const settings = {volume: 35, effects: true, tips: true, ...saved.settings};
let level;
let players;
let elapsed;
let particles;
let status;
let animationTime = 0;
let audioContext;
let onlineRole = 'local';
let onlineReady = false;
let remoteControls = {left: false, right: false, jump: false};
const heldKeys = new Set();
const pressedKeys = new Set();
const controls = [
  {left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp'},
  {left: 'KeyA', right: 'KeyD', jump: 'KeyW'}
];

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({last: level.number, best, settings}));
  } catch {
    // Ограничения браузера на хранилище не мешают игре.
  }
}

function loadImage(path) {
  const image = new Image();
  image.src = path;
  return image;
}

const artwork = {
  players: [loadImage('fire.svg'), loadImage('water.svg')],
  stone: loadImage('stone.svg'),
  door: loadImage('door.svg'),
  temple: loadImage('temple.svg')
};

function playSound(frequency, duration = 0.12) {
  if (!settings.volume) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  audioContext ||= new Audio();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const time = audioContext.currentTime;
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(frequency, time);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.8, time + duration);
  gain.gain.setValueAtTime(settings.volume / 900, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + duration);
}

function startLevel(number) {
  level = createLevel(number);
  players = level.starts.map(({x, y}, kind) => ({
    x, y, kind, vx: 0, vy: 0, grounded: true, support: null,
    facing: 1, atDoor: false, walkTime: 0, jumpBuffer: 0
  }));
  elapsed = 0;
  particles = [];
  status = 'playing';
  clearKeys();
  byId('overlay').hidden = true;
  byId('hint').textContent = level.gates.some((gate) => gate.timer)
    ? 'У решётки с полоской есть таймер. Проходите вдвоём, пока она открыта.'
    : level.gates.some((gate) => gate.paired)
      ? 'Два значка на решётке — встаньте на обе цветные кнопки одновременно.'
      : 'Открывайте решётки кнопками своего цвета. Зелёные лужи опасны для обоих.';
  byId('chapter').textContent = `${level.title} · УРОВЕНЬ ${number} / ${LEVEL_COUNT}`;
  updateStats();
  saveProgress();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function clearKeys() {
  heldKeys.clear();
  pressedKeys.clear();
}

function updateStats() {
  const gems = level.gems.filter((gem) => gem.collected).length;
  const seconds = Math.floor(elapsed / 60);
  byId('stats').textContent = `Кристаллы ${gems}/${level.gems.length} · ${seconds} с`;
}

function showOverlay(nextStatus, title, description, buttonText) {
  status = nextStatus;
  clearKeys();
  byId('result-title').textContent = title;
  byId('result-text').textContent = description;
  byId('continue').textContent = buttonText;
  byId('overlay').hidden = false;
  byId('continue').focus();
}

function continueGame() {
  if (status === 'pause') {
    status = 'playing';
    byId('overlay').hidden = true;
    byId('continue').blur();
  } else if (status === 'won' && level.number < LEVEL_COUNT) {
    startLevel(level.number + 1);
  } else if (status === 'won') {
    byId('overlay').hidden = true;
    openLevelMenu();
  } else {
    startLevel(level.number);
  }
}

function bodyBox(player) {
  return {x: player.x - 12, y: player.y - 32, w: 24, h: 32};
}

function intersects(first, second) {
  return first.x < second.x + second.w && first.x + first.w > second.x &&
    first.y < second.y + second.h && first.y + first.h > second.y;
}

function updateGates() {
  for (const gate of level.gates) {
    const switches = level.plates.filter((plate) => plate.gate === gate);
    for (const plate of switches) {
      plate.active = players.some((player) => player.kind === plate.kind && player.grounded &&
        Math.abs(player.y - plate.y) < 3 && player.x >= plate.x && player.x <= plate.x + plate.w);
    }
    const activated = switches.every((plate) => plate.active);
    if (activated && !gate.previous) playSound(280);
    if (activated) {
      if (gate.timer) gate.open = gate.duration;
      else gate.latched = true;
    } else if (gate.open > 0) {
      gate.open--;
    }
    gate.previous = activated;
  }
}

function gateIsOpen(gate) {
  return gate.latched || gate.open > 0;
}

function updatePlayer(player, keys) {
  const remote = onlineRole === 'host' && player.kind === 1 ? remoteControls : null;
  if (player.support?.baseY !== undefined) player.y += player.support.delta;
  const direction = remote ? Number(remote.right) - Number(remote.left)
    : Number(heldKeys.has(keys.right)) - Number(heldKeys.has(keys.left));
  player.vx = direction * 4.05;
  if (direction) {
    player.facing = direction;
    player.walkTime++;
  }

  if (remote ? remote.jump : pressedKeys.has(keys.jump)) player.jumpBuffer = 6;
  if (remote) remote.jump = false;
  if (player.jumpBuffer > 0 && player.grounded) {
    player.vy = -11.2;
    player.grounded = false;
    player.support = null;
    player.jumpBuffer = 0;
    playSound(player.kind === 0 ? 360 : 465);
  }
  player.jumpBuffer = Math.max(0, player.jumpBuffer - 1);

  const oldX = player.x;
  player.x = Math.max(13, Math.min(WIDTH - 13, oldX + player.vx));
  for (const gate of level.gates) {
    if (!gateIsOpen(gate) && intersects(bodyBox(player), gate)) {
      player.x = oldX < gate.x + gate.w / 2 ? gate.x - 12 : gate.x + gate.w + 12;
    }
  }

  const oldY = player.y;
  player.vy = Math.min(player.vy + 0.53, 14);
  player.y += player.vy;
  player.grounded = false;
  player.support = null;
  if (player.vy >= 0) {
    // Платформы пропускают вверх. При падении выбирается первая поверхность.
    for (const platform of [...level.platforms, ...level.movers]) {
      if (player.x + 11 > platform.x && player.x - 11 < platform.x + platform.w &&
          oldY <= platform.y + 0.1 && player.y >= platform.y) {
        player.y = platform.y;
        player.vy = 0;
        player.grounded = true;
        player.support = platform;
      }
    }
  }

  for (const pool of level.pools) {
    // Проверяем касание поверхности ногами при приземлении или ходьбе.
    const touchesSurface = player.vy >= 0 && player.y > pool.y && player.y <= pool.y + pool.h + 4;
    const overlapsPool = player.x + 12 > pool.x && player.x - 12 < pool.x + pool.w;
    if (pool.kind !== player.kind && touchesSurface && overlapsPool) return false;
  }
  if (player.y > HEIGHT + 30) return false;

  for (const gem of level.gems) {
    if (!gem.collected && gem.kind === player.kind &&
        Math.abs(player.x - gem.x) < 20 && Math.abs(player.y - 18 - gem.y) < 23) {
      gem.collected = true;
      playSound(710);
      if (settings.effects) {
        for (let index = 0; index < 12; index++) {
          const angle = index * Math.PI / 6;
          particles.push({x: gem.x, y: gem.y, vx: Math.cos(angle) * 2,
            vy: Math.sin(angle) * 2, life: 23, color: COLORS[gem.kind]});
        }
      }
    }
  }
  const door = level.doors[player.kind];
  player.atDoor = player.grounded && Math.abs(player.x - door.x) < 21 && Math.abs(player.y - door.y) < 4;
  return true;
}

function updateGame() {
  elapsed++;
  for (const mover of level.movers) {
    const nextY = mover.baseY + Math.sin(elapsed / 46 + mover.phase) * mover.range;
    mover.delta = nextY - mover.y;
    mover.y = nextY;
  }
  for (const [index, player] of players.entries()) {
    if (!updatePlayer(player, controls[index])) {
      playSound(138, 0.35);
      showOverlay('lost', 'Попробуйте ещё раз', 'К выходу нужно привести обоих героев.', 'Повторить');
      return;
    }
  }
  updateGates();
  pressedKeys.clear();
  particles = particles.filter((particle) => particle.life > 0);
  for (const particle of particles) {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.life--;
  }
  if (elapsed % 15 === 0) updateStats();

  if (players.every((player) => player.atDoor)) {
    const gems = level.gems.filter((gem) => gem.collected).length;
    const time = Math.ceil(elapsed / 60);
    const previous = best[level.number];
    if (!previous || gems > previous.gems || (gems === previous.gems && time < previous.time)) {
      best[level.number] = {gems, time};
    }
    saveProgress();
    updateStats();
    playSound(930, 0.45);
    const finalLevel = level.number === LEVEL_COUNT;
    showOverlay('won', finalLevel ? 'Сердце храма открыто!' : 'Уровень пройден',
      `Кристаллы: ${gems} из ${level.gems.length}. Время: ${time} с.`,
      finalLevel ? 'К карте уровней' : 'Следующий уровень');
  }
}

function drawImage(image, x, y, width, height) {
  if (!image.complete || !image.naturalWidth) return false;
  context.drawImage(image, x, y, width, height);
  return true;
}

function drawPlatform(platform) {
  for (let offset = 0; offset < platform.w; offset += 48) {
    const width = Math.min(platform.w - offset, 48);
    if (!drawImage(artwork.stone, platform.x + offset, platform.y, width, platform.h)) {
      context.fillStyle = '#716b50';
      context.fillRect(platform.x + offset, platform.y, width, platform.h);
    }
  }
  if (platform.baseY !== undefined) {
    context.fillStyle = level.accent;
    context.fillRect(platform.x, platform.y, platform.w, 3);
  }
}

function drawPool(pool) {
  const {x, y, w, h, kind} = pool;
  context.save();
  if (settings.effects) {
    context.shadowColor = COLORS[kind];
    context.shadowBlur = 13;
  }
  const gradient = context.createLinearGradient(0, y - 3, 0, y + h);
  gradient.addColorStop(0, COLORS[kind]);
  gradient.addColorStop(1, ['#a93424', '#245a91', '#50762d'][kind]);
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(x, y + 3);
  for (let offset = 0; offset <= w; offset += 2) {
    context.lineTo(x + offset, y + Math.sin(animationTime / 11 + offset / 7) * 2);
  }
  context.lineTo(x + w, y + h);
  context.lineTo(x, y + h);
  context.closePath();
  context.fill();
  context.restore();
}

function drawDiamond(x, y, radius, color, width = radius) {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x, y - radius);
  context.lineTo(x + width, y);
  context.lineTo(x, y + radius);
  context.lineTo(x - width, y);
  context.closePath();
  context.fill();
}

function drawGates() {
  for (const gate of level.gates) {
    const closed = !gateIsOpen(gate);
    const height = closed ? gate.h : 12;
    const switches = level.plates.filter((plate) => plate.gate === gate);
    context.fillStyle = '#776c52';
    context.fillRect(gate.x - 5, gate.y - 5, gate.w + 10, 8);
    context.fillStyle = '#9d8e67';
    for (let bar = 2; bar < gate.w; bar += 5) {
      context.fillRect(gate.x + bar, gate.y, 2, height);
    }
    for (let y = gate.y + 8; y < gate.y + height; y += 15) {
      context.fillRect(gate.x, y, gate.w, 3);
    }
    switches.forEach((plate, index) => {
      drawDiamond(gate.x + gate.w / 2 + index * 13 - (switches.length - 1) * 6, gate.y - 12, 5, COLORS[plate.kind]);
    });
    if (gate.timer) {
      context.fillStyle = '#594c34';
      context.fillRect(gate.x - 8, gate.y - 25, 32, 3);
      context.fillStyle = '#ffc775';
      context.fillRect(gate.x - 8, gate.y - 25, 32 * gate.open / gate.duration, 3);
    }
  }
  for (const plate of level.plates) {
    const height = plate.active ? 3 : 7;
    context.fillStyle = '#2d3027';
    context.fillRect(plate.x - 3, plate.y - 3, plate.w + 6, 4);
    context.fillStyle = COLORS[plate.kind];
    context.fillRect(plate.x, plate.y - height, plate.w, height);
    context.fillStyle = '#1d241c';
    context.textAlign = 'center';
    context.font = 'bold 10px sans-serif';
    context.fillText(plate.kind === 0 ? 'О' : 'В', plate.x + plate.w / 2, plate.y - 10);
  }
}

function drawDoors() {
  for (const door of level.doors) {
    const color = COLORS[door.kind];
    const open = players[door.kind].atDoor;
    context.save();
    if (settings.effects && open) {
      context.shadowColor = color;
      context.shadowBlur = 22;
    }
    drawImage(artwork.door, door.x - 26, door.y - 68, 52, 68);
    context.globalAlpha = open ? 0.8 : 0.25;
    context.fillStyle = color;
    context.beginPath();
    context.arc(door.x, door.y - 42, 15, Math.PI, 0);
    context.lineTo(door.x + 15, door.y);
    context.lineTo(door.x - 15, door.y);
    context.closePath();
    context.fill();
    context.globalAlpha = 1;
    drawDiamond(door.x, door.y - 36, 8, color, 6);
    context.restore();
  }
}

function drawPlayer(player) {
  const {kind, facing, x, y, vx, grounded, walkTime} = player;
  const stride = vx && grounded ? Math.sin(walkTime * 0.46) * 3 : 0;
  const sway = grounded ? Math.sin(animationTime / 14 + kind) : 0;
  context.save();
  context.translate(x, y);
  context.scale(facing, 1);
  context.fillStyle = '#12191599';
  context.beginPath();
  context.ellipse(0, 0, 12, 2.5, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = COLORS[kind];
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(-5, -8);
  context.lineTo(-6 + stride, -2);
  context.moveTo(5, -8);
  context.lineTo(6 - stride, -2);
  context.stroke();
  if (!drawImage(artwork.players[kind], -15, -39 + sway, 30, 38)) {
    drawDiamond(0, -19, 13, COLORS[kind], 10);
  }
  context.restore();
}

function render() {
  context.fillStyle = '#18211d';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  drawImage(artwork.temple, 0, 0, WIDTH, HEIGHT);
  context.save();
  context.globalAlpha = 0.1;
  context.fillStyle = level.accent;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.restore();
  for (const platform of [...level.platforms, ...level.movers]) drawPlatform(platform);
  for (const pool of level.pools) drawPool(pool);
  drawDoors();
  drawGates();
  for (const gem of level.gems) {
    if (gem.collected) continue;
    const rotation = 0.5 + Math.abs(Math.sin(animationTime / 25 + gem.x)) * 0.5;
    const y = gem.y + Math.sin(animationTime / 18 + gem.x) * 3;
    drawDiamond(gem.x, y, 9, COLORS[gem.kind], 7 * rotation);
    drawDiamond(gem.x - 1, y - 2, 3, '#fff6db', 2);
  }
  for (const player of players) drawPlayer(player);
  for (const particle of particles) {
    context.globalAlpha = particle.life / 23;
    context.fillStyle = particle.color;
    context.fillRect(particle.x, particle.y, 3, 3);
  }
  context.globalAlpha = 1;
}

const levelMenu = byId('level-menu');
const settingsMenu = byId('settings-menu');

function openLevelMenu() {
  const map = byId('map');
  map.replaceChildren();
  for (let number = 1; number <= LEVEL_COUNT; number++) {
    const button = document.createElement('button');
    const record = best[number];
    button.textContent = record ? `${number} ✓` : number;
    button.classList.toggle('done', Boolean(record));
    button.classList.toggle('current', number === level.number);
    button.title = record ? `${record.gems} кристаллов · ${record.time} с` : CHAPTERS[Math.floor((number - 1) / 10)][0];
    button.addEventListener('click', () => {
      levelMenu.close();
      startLevel(number);
    });
    map.append(button);
  }
  clearKeys();
  levelMenu.showModal();
}

function updateSettings() {
  byId('hint').hidden = !settings.tips;
  saveProgress();
}

byId('levels').onclick = openLevelMenu;
byId('restart').onclick = () => startLevel(level.number);
byId('continue').onclick = continueGame;
byId('settings').onclick = () => {
  clearKeys();
  settingsMenu.showModal();
};
for (const key of ['volume', 'effects', 'tips']) {
  const input = byId(key);
  if (key === 'volume') input.value = settings[key];
  else input.checked = settings[key];
  input.addEventListener('input', () => {
    settings[key] = key === 'volume' ? Number(input.value) : input.checked;
    updateSettings();
  });
}

const fullscreen = byId('fullscreen');
fullscreen.disabled = !document.fullscreenEnabled;
fullscreen.onchange = async () => {
  try {
    if (fullscreen.checked) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    fullscreen.checked = Boolean(document.fullscreenElement);
  }
};
document.addEventListener('fullscreenchange', () => {
  fullscreen.checked = Boolean(document.fullscreenElement);
});

const gameKeys = new Set(controls.flatMap((player) => Object.values(player)));
window.addEventListener('keydown', (event) => {
  if (levelMenu.open || settingsMenu.open || byId('online-menu').open || event.ctrlKey || event.metaKey || event.altKey) return;
  if (gameKeys.has(event.code)) {
    event.preventDefault();
    const assigned = onlineRole === 'guest' ? controls[1] : controls[0];
    if (onlineRole !== 'local' && !Object.values(assigned).includes(event.code)) return;
    if (status === 'playing') {
      if (!heldKeys.has(event.code)) pressedKeys.add(event.code);
      heldKeys.add(event.code);
    }
  }
  if (onlineRole === 'guest') return;
  if (event.code === 'KeyR' && !event.repeat) startLevel(level.number);
  if (event.code === 'Escape' && !event.repeat) {
    if (status === 'playing') showOverlay('pause', 'Пауза', 'Оба героя ждут вас.', 'Продолжить');
    else if (status === 'pause') continueGame();
  }
});
window.addEventListener('keyup', (event) => heldKeys.delete(event.code));
window.addEventListener('blur', clearKeys);
document.addEventListener('visibilitychange', clearKeys);

function onlineSnapshot() {
  const playerViews = players.map(({x, y, kind, vx, grounded, facing, atDoor, walkTime}) =>
    ({x, y, kind, vx, grounded, facing, atDoor, walkTime}));
  return {
    number: level.number, elapsed, status, players: playerViews,
    gems: level.gems.map((gem) => Boolean(gem.collected)),
    gates: level.gates.map(({open, latched}) => ({open, latched})),
    plates: level.plates.map((plate) => Boolean(plate.active)),
    movers: level.movers.map((mover) => mover.y),
    overlay: byId('overlay').hidden ? null : {
      title: byId('result-title').textContent, description: byId('result-text').textContent
    }
  };
}

function applyOnlineSnapshot(state) {
  const changedLevel = state.number !== level.number || state.elapsed < elapsed;
  if (changedLevel) startLevel(state.number);
  elapsed = state.elapsed;
  players = state.players;
  level.gems.forEach((gem, i) => { gem.collected = state.gems[i]; });
  level.gates.forEach((gate, i) => Object.assign(gate, state.gates[i]));
  level.plates.forEach((plate, i) => { plate.active = state.plates[i]; });
  level.movers.forEach((mover, i) => { mover.y = state.movers[i]; });
  if (status !== state.status) clearKeys();
  status = state.status;
  byId('overlay').hidden = !state.overlay;
  if (state.overlay) {
    byId('result-title').textContent = state.overlay.title;
    byId('result-text').textContent = state.overlay.description + ' Продолжение выбирает создатель комнаты.';
  }
  updateStats();
}

let lastFrame;
let pendingTime = 0;
const FRAME_TIME = 1000 / 60;

function frame(now) {
  pendingTime += Math.min(80, now - (lastFrame ?? now));
  lastFrame = now;
  while (pendingTime >= FRAME_TIME) {
    pendingTime -= FRAME_TIME;
    animationTime++;
    const canSimulate = onlineRole === 'local' || (onlineRole === 'host' && onlineReady);
    if (canSimulate && status === 'playing' && !levelMenu.open && !settingsMenu.open &&
        !byId('online-menu').open && !document.hidden) updateGame();
  }
  render();
  requestAnimationFrame(frame);
}

const lastLevel = Number.isInteger(saved.last) && saved.last >= 1 && saved.last <= LEVEL_COUNT ? saved.last : 1;
startLevel(lastLevel);
updateSettings();
requestAnimationFrame(frame);
