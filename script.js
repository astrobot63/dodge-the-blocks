
const $ = (id) => document.getElementById(id);

const arena = $("arena");
const player = $("player");
const entitiesLayer = $("entities");
const overlay = $("overlay");
const overlayTitle = $("overlayTitle");
const overlayText = $("overlayText");
const startButton = $("startButton");

const STORE_KEY = "dodgeBlocksDeluxe_v1";

const defaultSave = () => ({
  coins: 0,
  best: 0,
  totalCoins: 0,
  totalRuns: 0,
  achievements: [],
  inventory: { shield: 0, magnet: 0, slow: 0, boost: 0 },
  skins: ["neon"],
  themes: ["neon"],
  skin: "neon",
  theme: "neon",
  sound: true,
  lastDaily: "",
  missionClaimed: false
});

function loadSave() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!stored || typeof stored !== "object") return defaultSave();

    const fresh = defaultSave();
    const result = { ...fresh, ...stored };

    result.inventory = {
      ...fresh.inventory,
      ...(stored.inventory || {})
    };

    result.achievements = Array.isArray(stored.achievements)
      ? stored.achievements : [""];

    result.skins = Array.isArray(stored.skins)
      ? stored.skins : ["neon"];

    result.themes = Array.isArray(stored.themes)
      ? stored.themes : ["neon"];

    result.achievements = result.achievements.filter(Boolean);
    result.coins = Math.max(0, Math.floor(Number(result.coins) || 0));
    result.best = Math.max(0, Math.floor(Number(result.best) || 0));

    if (!result.skins.includes(result.skin)) result.skin = "neon";
    if (!result.themes.includes(result.theme)) result.theme = "neon";

    return result;
  } catch {
    return defaultSave();
  }
}

let save = loadSave();
let running = false;
let paused = false;
let gameOver = false;
let animationId = null;
let lastTime = 0;
let elapsed = 0;
let score = 0;
let runCoins = 0;
let playerX = 50;
let playerY = 78;
let spawnTimer = 0;
let coinTimer = 1.5;
let comboCount = 0;
let comboTimer = 0;
let blocks = [];
let coins = [];
let keys = {};
let activePerks = { shield: 0, magnet: 0, slow: 0, boost: 0 };
let runStats = { collected: 0, survived: 0 };
let soundContext = null;

const PERKS = {
  shield: {
    name: "Shield",
    icon: "🛡️",
    description: "Blocks one collision.",
    price: 90,
    duration: 0
  },
  magnet: {
    name: "Coin magnet",
    icon: "🧲",
    description: "Pull nearby coins for 8 seconds.",
    price: 110,
    duration: 8
  },
  slow: {
    name: "Slow motion",
    icon: "🐢",
    description: "Slows obstacles for 6 seconds.",
    price: 100,
    duration: 6
  },
  boost: {
    name: "Speed boost",
    icon: "⚡",
    description: "Move faster for 6 seconds.",
    price: 100,
    duration: 6
  }
};

const SHOP_ITEMS = [
  ...Object.entries(PERKS).map(([id, perk]) => ({
    id,
    icon: perk.icon,
    name: perk.name,
    description: perk.description,
    price: perk.price,
    type: "perk"
  })),
  {
    id: "sunset",
    icon: "🌅",
    name: "Sunset skin",
    description: "A warm orange glow.",
    price: 250,
    type: "skin"
  },
  {
    id: "ice",
    icon: "🧊",
    name: "Ice skin",
    description: "Cool blue style.",
    price: 400,
    type: "skin"
  },
  {
    id: "gold",
    icon: "👑",
    name: "Gold skin",
    description: "For certified coin collectors.",
    price: 700,
    type: "skin"
  },
  {
    id: "forest",
    icon: "🌲",
    name: "Forest arena",
    description: "A greener playing field.",
    price: 200,
    type: "theme"
  },
  {
    id: "ember",
    icon: "🔥",
    name: "Ember arena",
    description: "A fiery new look.",
    price: 350,
    type: "theme"
  }
];

const ACHIEVEMENTS = [
  { id: "first", icon: "🎮", name: "First run", check: () => save.totalRuns >= 1 },
  { id: "collector", icon: "🪙", name: "Coin collector", check: () => save.totalCoins >= 25 },
  { id: "survivor", icon: "⏳", name: "Survivor", check: () => save.best >= 300 },
  { id: "rich", icon: "💰", name: "Loaded", check: () => save.coins >= 500 },
  { id: "champion", icon: "🏆", name: "Block champion", check: () => save.best >= 1000 }
];

const DIFFICULTIES = {
  chill: { speed: 0.75, spawn: 1.25 },
  normal: { speed: 1, spawn: 1 },
  chaos: { speed: 1.25, spawn: 0.85 }
};

function saveProgress() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(save));
  } catch {
    // The game can still run if browser storage is unavailable.
  }
}

function sound(frequency = 600, duration = 0.07, type = "sine") {
  if (!save.sound) return;

  try {
    soundContext ||= new (window.AudioContext || window.webkitAudioContext)();

    if (soundContext.state === "suspended") {
      soundContext.resume();
    }

    const oscillator = soundContext.createOscillator();
    const gain = soundContext.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.045;
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      soundContext.currentTime + duration
    );

    oscillator.connect(gain);
    gain.connect(soundContext.destination);
    oscillator.start();
    oscillator.stop(soundContext.currentTime + duration);
  } catch {
    // Sound is optional.
  }
}

function updateHUD() {
  $("coinBank").textContent = save.coins;
  $("score").textContent = Math.floor(score);
  $("best").textContent = Math.floor(save.best);
  $("runCoins").textContent = runCoins;
  $("combo").textContent = `x${Math.max(1, Math.min(5, comboCount))}`;
}

function applyAppearance() {
  player.className = `player skin-${save.skin}`;
  arena.classList.remove("theme-neon", "theme-forest", "theme-ember");
  arena.classList.add(`theme-${save.theme}`);

  $("skinSelect").value = save.skin;
  $("themeSelect").value = save.theme;
  $("soundToggle").checked = save.sound;
}

function unlockAchievements() {
  let changed = false;

  for (const achievement of ACHIEVEMENTS) {
    if (!save.achievements.includes(achievement.id) && achievement.check()) {
      save.achievements.push(achievement.id);
      changed = true;
      sound(900, 0.14);
    }
  }

  if (changed) saveProgress();
  renderAchievements();
}

function renderAchievements() {
  $("achievements").innerHTML = "";

  for (const item of ACHIEVEMENTS) {
    const unlocked = save.achievements.includes(item.id);
    const row = document.createElement("div");
    row.className = `achievement ${unlocked ? "" : "locked"}`;
    row.innerHTML = `
      <span>${unlocked ? item.icon : "🔒"}</span>
      <span>${item.name}</span>
      <span>${unlocked ? "✓" : ""}</span>
    `;
    $("achievements").appendChild(row);
  }
}

function renderInventory() {
  $("inventory").innerHTML = "";

  for (const [id, perk] of Object.entries(PERKS)) {
    const count = save.inventory[id] || 0;
    const active = activePerks[id] > 0;
    const row = document.createElement("div");
    row.className = "inventory-item";

    const description = active
      ? `Active: ${Math.ceil(activePerks[id])}s`
      : `${count} available`;

    row.innerHTML = `
      <div class="inventory-name">
        <strong>${perk.icon} ${perk.name}</strong>
        <small>${description}</small>
      </div>
      <button data-use="${id}" ${count < 1 || active ? "disabled" : ""}>
        ${active ? "Active" : "Use"}
      </button>
    `;

    $("inventory").appendChild(row);
  }
}

function renderShop() {
  $("shop").innerHTML = "";

  for (const item of SHOP_ITEMS) {
    const owned = item.type === "skin"
      ? save.skins.includes(item.id)
      : item.type === "theme"
        ? save.themes.includes(item.id)
        : false;

    const active = item.type === "skin"
      ? save.skin === item.id
      : item.type === "theme"
        ? save.theme === item.id
        : false;

    const buttonLabel = item.type === "perk"
      ? `Buy · ${item.price} 🪙`
      : active
        ? "Equipped"
        : owned
          ? "Equip"
          : `Buy · ${item.price} 🪙`;

    const disabled = active || (item.type !== "perk" && owned);

    const card = document.createElement("div");
    card.className = "shop-item";
    card.innerHTML = `
      <div class="shop-icon">${item.icon}</div>
      <div class="shop-description">
        <strong>${item.name}</strong>
        <small>${item.description}</small>
        <button data-shop="${item.id}" ${disabled ? "disabled" : ""}>
          ${buttonLabel}
        </button>
      </div>
    `;

    $("shop").appendChild(card);
  }
}

function renderMission() {
  const target = 10;
  const progress = Math.min(runCoins, target);
  $("missionText").textContent = "Collect 10 coins in one run.";
  $("missionProgress").style.width = `${progress / target * 100}%`;

  if (save.missionClaimed) {
    $("missionStatus").textContent = "Mission reward claimed today.";
  } else if (runCoins >= target) {
    $("missionStatus").textContent = "Mission complete! Claim 50 coins.";
  } else {
    $("missionStatus").textContent = `${progress}/${target} coins this run`;
  }
}

function renderDaily() {
  const today = new Date().toISOString().slice(0, 10);
  const claimed = save.lastDaily === today;

  $("dailyButton").disabled = claimed;
  $("dailyButton").textContent = claimed ? "Already claimed" : "Claim 75 coins";
  $("dailyStatus").textContent = claimed
    ? "Your next reward arrives tomorrow."
    : "One reward per day on this device.";
}

function refreshUI() {
  updateHUD();
  renderInventory();
  renderShop();
  renderAchievements();
  renderMission();
  renderDaily();
}

function buyItem(id) {
  const item = SHOP_ITEMS.find((entry) => entry.id === id);
  if (!item) return;

  if (item.type === "skin" && save.skins.includes(id)) {
    equipSkin(id);
    return;
  }

  if (item.type === "theme" && save.themes.includes(id)) {
    equipTheme(id);
    return;
  }

  if (save.coins < item.price) {
    $("customizeStatus").textContent = "Not enough coins. Keep collecting!";
    sound(180, 0.12, "square");
    return;
  }

  save.coins -= item.price;

  if (item.type === "perk") {
    save.inventory[id] = (save.inventory[id] || 0) + 1;
  } else if (item.type === "skin") {
    save.skins.push(id);
    save.skin = id;
    $("customizeStatus").textContent = `${item.name} unlocked and equipped!`;
  } else if (item.type === "theme") {
    save.themes.push(id);
    save.theme = id;
    $("customizeStatus").textContent = `${item.name} unlocked and equipped!`;
  }

  saveProgress();
  applyAppearance();
  refreshUI();
  sound(750, 0.12);
}

function equipSkin(id) {
  if (!save.skins.includes(id)) return;
  save.skin = id;
  saveProgress();
  applyAppearance();
  renderShop();
  $("customizeStatus").textContent = "Skin equipped!";
}

function equipTheme(id) {
  if (!save.themes.includes(id)) return;
  save.theme = id;
  saveProgress();
  applyAppearance();
  renderShop();
  $("customizeStatus").textContent = "Arena theme equipped!";
}

function usePerk(id) {
  if (!running || paused || !PERKS[id]) return;
  if ((save.inventory[id] || 0) < 1) return;
  if (activePerks[id] > 0) return;

  save.inventory[id]--;
  activePerks[id] = id === "shield" ? 1 : PERKS[id].duration;

  saveProgress();
  renderInventory();
  sound(700, 0.1);
  updateShieldVisual();
}

function updateShieldVisual() {
  player.classList.toggle(
    "shielded",
    activePerks.shield > 0
  );
}

function claimDailyReward() {
  const today = new Date().toISOString().slice(0, 10);
  if (save.lastDaily === today) return;

  save.lastDaily = today;
  save.coins += 75;
  saveProgress();
  refreshUI();
  sound(850, 0.18);
}

function claimMission() {
  if (save.missionClaimed || runCoins < 10) return;

  save.missionClaimed = true;
  save.coins += 50;
  saveProgress();
  refreshUI();
  sound(1000, 0.18);
}

function clearEntities() {
  for (const entity of [...blocks, ...coins]) {
    entity.el.remove();
  }

  blocks = [];
  coins = [];
  entitiesLayer.innerHTML = "";
}

function makeEntity(type, x, y, speed, direction = 1, value = 0) {
  const el = document.createElement("div");
  el.className = type === "block"
    ? "block"
    : `coin ${value > 1 ? "rare" : ""}`;

  if (type === "block" && direction !== 0) {
    el.classList.add("side-block");
  }

  if (type === "coin") el.textContent = value > 1 ? "★" : "";

  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  entitiesLayer.appendChild(el);

  const entity = { el, x, y, speed, direction, value, type };

  if (type === "block") blocks.push(entity);
  else coins.push(entity);

  return entity;
}

function spawnBlock() {
  const difficulty = DIFFICULTIES[$("difficulty").value];
  const level = Math.min(elapsed / 35, 1.5);
  const speed = (18 + Math.min(elapsed * 0.18, 12)) *
    difficulty.speed;

  // More top obstacles than side obstacles keeps movement fair.
  const side = Math.random() < Math.min(0.25 + elapsed / 180, 0.4);

  if (side) {
    const fromLeft = Math.random() < 0.5;
    const y = 10 + Math.random() * 78;

    makeEntity(
      "block",
      fromLeft ? -6 : 101,
      y,
      speed * 0.85,
      fromLeft ? 1 : -1
    );
  } else {
    makeEntity(
      "block",
      4 + Math.random() * 92,
      -6,
      speed * 0.9,
      0
    );
  }

  // Occasional second obstacle, never a giant unavoidable wall.
  if (elapsed > 18 && Math.random() < 0.12) {
    makeEntity(
      "block",
      5 + Math.random() * 90,
      -8,
      speed * 0.75,
      0
    );
  }
}

function spawnCoin() {
  const rare = Math.random() < 0.09;
  makeEntity(
    "coin",
    5 + Math.random() * 90,
    -4,
    15 + Math.min(elapsed * 0.1, 10),
    0,
    rare ? 5 : 1
  );
}

function setEntityPosition(entity) {
  entity.el.style.left = `${entity.x}%`;
  entity.el.style.top = `${entity.y}%`;
}

function movePlayer(dt) {
  let dx = 0;
  let dy = 0;

  if (keys.ArrowLeft || keys.a) dx--;
  if (keys.ArrowRight || keys.d) dx++;
  if (keys.ArrowUp || keys.w) dy--;
  if (keys.ArrowDown || keys.s) dy++;

  if (dx && dy) {
    dx *= 0.7071;
    dy *= 0.7071;
  }

  const boost = activePerks.boost > 0 ? 1.65 : 1;
  const speed = 47 * boost;

  playerX = Math.max(3, Math.min(97, playerX + dx * speed * dt));
  playerY = Math.max(4, Math.min(96, playerY + dy * speed * dt));

  player.style.left = `${playerX}%`;
  player.style.top = `${playerY}%`;
}

function collides(entity) {
  const dx = Math.abs(entity.x + 2.5 - playerX);
  const dy = Math.abs(entity.y + 2.5 - playerY);

  return dx < 4.5 && dy < 6;
}

function collectCoin(coin, index) {
  coin.el.remove();
  coins.splice(index, 1);

  const value = coin.value;
  const multiplier = Math.min(5, Math.max(1, comboCount + 1));

  runCoins += value;
  save.coins += value;
  save.totalCoins += value;
  runStats.collected += value;

  comboCount = comboTimer > 0 ? Math.min(comboCount + 1, 5) : 1;
  comboTimer = 3;

  // Every 10 coins collected in one run completes the mission.
  if (runCoins >= 10) claimMission();

  saveProgress();
  unlockAchievements();
  updateHUD();
  renderMission();
  renderShop();

  sound(value > 1 ? 1050 : 750, 0.07);
}

function updateEntities(dt) {
  const slowFactor = activePerks.slow > 0 ? 0.48 : 1;
  const magnetActive = activePerks.magnet > 0;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];

    if (block.direction === 0) {
      block.y += block.speed * dt * slowFactor;
    } else {
      block.x += block.speed * dt * block.direction * slowFactor;
    }

    setEntityPosition(block);

    if (collides(block)) {
      if (activePerks.shield > 0) {
        activePerks.shield = 0;
        block.el.remove();
        blocks.splice(i, 1);
        updateShieldVisual();
        sound(450, 0.15);
        renderInventory();
        continue;
      }

      endGame();
      return;
    }

    if (block.y > 106 || block.x < -12 || block.x > 108) {
      block.el.remove();
      blocks.splice(i, 1);
    }
  }

  for (let i = coins.length - 1; i >= 0; i--) {
    const coin = coins[i];

    if (magnetActive) {
      const dx = playerX - coin.x;
      const dy = playerY - coin.y;

      if (Math.abs(dx) < 28 && Math.abs(dy) < 28) {
        const pull = Math.min(1, dt * 2.8);
        coin.x += dx * pull;
        coin.y += dy * pull;
      } else {
        coin.y += coin.speed * dt * slowFactor;
      }
    } else {
      coin.y += coin.speed * dt * slowFactor;
    }

    setEntityPosition(coin);

    if (collides(coin)) {
      collectCoin(coin, i);
      continue;
    }

    if (coin.y > 105) {
      coin.el.remove();
      coins.splice(i, 1);
    }
  }
}

function updatePerks(dt) {
  for (const id of Object.keys(activePerks)) {
    if (activePerks[id] > 0 && id !== "shield") {
      activePerks[id] = Math.max(0, activePerks[id] - dt);
    }
  }

  updateShieldVisual();
}

function gameLoop(timestamp) {
  if (!running || paused) return;

  const dt = Math.min((timestamp - lastTime) / 1000 || 0, 0.04);
  lastTime = timestamp;

  elapsed += dt;
  runStats.survived = elapsed;
  score += dt * 10 * Math.min(5, Math.max(1, comboCount));

  spawnTimer += dt;
  coinTimer += dt;
  comboTimer -= dt;

  if (comboTimer <= 0) comboCount = 0;

  const difficulty = DIFFICULTIES[$("difficulty").value];
  const spawnInterval = Math.max(
    0.42,
    (0.95 - Math.min(elapsed / 180, 0.35)) * difficulty.spawn
  );

  if (spawnTimer >= spawnInterval) {
    spawnTimer = 0;
    spawnBlock();
  }

  if (coinTimer >= 1.5) {
    coinTimer = 0;
    spawnCoin();
  }

  movePlayer(dt);
  updateEntities(dt);

  if (!running) return;

  updatePerks(dt);
  updateHUD();

  if (Math.floor(score) > save.best) {
    save.best = Math.floor(score);
    $("best").textContent = save.best;
  }

  if (Math.floor(elapsed) % 5 === 0) {
    // Saving best scores happens at game over to avoid constant writes.
  }

  animationId = requestAnimationFrame(gameLoop);
}

function startGame() {
  if (running && paused) {
    paused = false;
    overlay.classList.add("hidden");
    $("pauseButton").textContent = "⏸ Pause";
    lastTime = performance.now();
    animationId = requestAnimationFrame(gameLoop);
    return;
  }

  if (running) return;

  clearEntities();
  cancelAnimationFrame(animationId);

  score = 0;
  runCoins = 0;
  elapsed = 0;
  playerX = 50;
  playerY = 78;
  spawnTimer = 0;
  coinTimer = 1;
  comboCount = 0;
  comboTimer = 0;
  activePerks = { shield: 0, magnet: 0, slow: 0, boost: 0 };
  runStats = { collected: 0, survived: 0 };

  player.style.left = `${playerX}%`;
  player.style.top = `${playerY}%`;
  updateShieldVisual();

  running = true;
  paused = false;
  gameOver = false;

  save.totalRuns++;
  save.missionClaimed = false;
  saveProgress();

  overlay.classList.add("hidden");
  $("pauseButton").disabled = false;
  $("pauseButton").textContent = "⏸ Pause";
  startButton.textContent = "Start game";

  refreshUI();
  lastTime = performance.now();
  animationId = requestAnimationFrame(gameLoop);
}

function endGame() {
  running = false;
  paused = false;
  gameOver = true;

  cancelAnimationFrame(animationId);

  save.best = Math.max(save.best, Math.floor(score));
  saveProgress();
  unlockAchievements();
  refreshUI();

  $("pauseButton").disabled = true;
  $("pauseButton").textContent = "⏸ Pause";

  overlayTitle.textContent = "Game Over!";
  overlayText.textContent =
    `You scored ${Math.floor(score)} points and collected ${runCoins} coins.`;
  startButton.textContent = "Play again";
  overlay.classList.remove("hidden");

  sound(160, 0.28, "sawtooth");
}

function togglePause() {
  if (!running) return;

  paused = !paused;

  if (paused) {
    cancelAnimationFrame(animationId);
    overlayTitle.textContent = "Paused";
    overlayText.textContent = "Take a breath. The blocks can wait.";
    startButton.textContent = "Resume";
    overlay.classList.remove("hidden");
    $("pauseButton").textContent = "▶ Resume";
  } else {
    overlay.classList.add("hidden");
    $("pauseButton").textContent = "⏸ Pause";
    lastTime = performance.now();
    animationId = requestAnimationFrame(gameLoop);
  }
}

function restartGame() {
  cancelAnimationFrame(animationId);
  running = false;
  paused = false;
  startGame();
}

function resetProgress() {
  const confirmed = confirm(
    "Reset all coins, skins, upgrades, achievements and records? This cannot be undone."
  );

  if (!confirmed) return;

  cancelAnimationFrame(animationId);
  running = false;
  paused = false;
  gameOver = false;
  clearEntities();

  save = defaultSave();
  activePerks = { shield: 0, magnet: 0, slow: 0, boost: 0 };
  score = 0;
  runCoins = 0;
  elapsed = 0;
  playerX = 50;
  playerY = 78;

  saveProgress();
  applyAppearance();
  refreshUI();

  overlayTitle.textContent = "Fresh start!";
  overlayText.textContent = "Everything has been reset. Your blocks await.";
  startButton.textContent = "Start game";
  overlay.classList.remove("hidden");
  $("pauseButton").disabled = true;
  $("customizeStatus").textContent = "Progress reset.";
}

document.addEventListener("keydown", (event) => {
  const key = event.key.length === 1
    ? event.key.toLowerCase()
    : event.key;

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key)) {
    event.preventDefault();
  }

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(key)) {
    keys[key] = true;
  }

  if (key === "p" && !event.repeat) togglePause();
  if (key === "1") usePerk("shield");
  if (key === "2") usePerk("magnet");
  if (key === "3") usePerk("slow");
  if (key === "4") usePerk("boost");
});

document.addEventListener("keyup", (event) => {
  const key = event.key.length === 1
    ? event.key.toLowerCase()
    : event.key;

  keys[key] = false;
});

window.addEventListener("blur", () => {
  keys = {};
  if (running && !paused) togglePause();
});

document.querySelectorAll("[data-move]").forEach((button) => {
  const directionKeys = {
    up: ["ArrowUp", "w"],
    down: ["ArrowDown", "s"],
    left: ["ArrowLeft", "a"],
    right: ["ArrowRight", "d"]
  };

  const setPressed = (pressed) => {
    for (const key of directionKeys[button.dataset.move]) {
      keys[key] = pressed;
    }
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    setPressed(true);
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener("pointerup", () => setPressed(false));
  button.addEventListener("pointercancel", () => setPressed(false));
  button.addEventListener("lostpointercapture", () => setPressed(false));
});

$("startButton").addEventListener("click", startGame);
$("restartButton").addEventListener("click", restartGame);
$("pauseButton").addEventListener("click", togglePause);
$("dailyButton").addEventListener("click", claimDailyReward);
$("resetProgressButton").addEventListener("click", resetProgress);

$("inventory").addEventListener("click", (event) => {
  const button = event.target.closest("[data-use]");
  if (button) usePerk(button.dataset.use);
});

$("shop").addEventListener("click", (event) => {
  const button = event.target.closest("[data-shop]");
  if (button) buyItem(button.dataset.shop);
});

$("skinSelect").addEventListener("change", (event) => {
  const skin = event.target.value;

  if (!save.skins.includes(skin)) {
    event.target.value = save.skin;
    $("customizeStatus").textContent = "Buy that skin in the shop first.";
    return;
  }

  equipSkin(skin);
});

$("themeSelect").addEventListener("change", (event) => {
  const theme = event.target.value;

  if (!save.themes.includes(theme)) {
    event.target.value = save.theme;
    $("customizeStatus").textContent = "Buy that arena theme in the shop first.";
    return;
  }

  equipTheme(theme);
});

$("soundToggle").addEventListener("change", (event) => {
  save.sound = event.target.checked;
  saveProgress();
});

applyAppearance();
refreshUI();

overlayTitle.textContent = "Ready?";
overlayText.textContent =
  "Move in four directions, dodge the blocks, and collect coins to buy upgrades.";
startButton.textContent = "Start game";