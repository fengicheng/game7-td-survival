import "./styles.css";
import { BOARD_HEIGHT, BOARD_WIDTH, CELL_SIZE, ENEMIES, GRID_HEIGHT, GRID_WIDTH, ITEMS, TOWERS, getTowerStats } from "./data";
import { GameState } from "./game";
import type { TowerType } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const game = new GameState();
let introVisible = true;

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="panel stats" id="stats"></div>
      <div class="panel controls">
        <button id="start-wave" class="primary">开始波次</button>
        <button id="repair-all">批量维修</button>
        <button id="shop-close" hidden>离开商店</button>
      </div>
    </header>
    <main class="main">
      <section class="left-panel panel">
        <h2>敌情与状态</h2>
        <div id="status"></div>
        <div id="selected-info"></div>
      </section>
      <section class="board-wrap">
        <div class="board panel" id="board" style="width:${BOARD_WIDTH}px;height:${BOARD_HEIGHT}px"></div>
      </section>
      <aside class="right-panel">
        <section class="panel">
          <h2>战斗道具栏</h2>
          <div id="inventory"></div>
        </section>
        <section class="panel" id="shop-panel">
          <h2>波间商店</h2>
          <div id="shop"></div>
        </section>
      </aside>
    </main>
    <footer class="bottom-bar panel">
      <div class="bar-title">防御塔下边栏</div>
      <div id="tower-bar" class="tower-bar"></div>
    </footer>
    <section class="intro-screen" id="intro-screen">
      <div class="intro-card panel">
        <p class="intro-kicker">单地图 · 无限波次 · 动态堵路塔防</p>
        <h1>多出发点堵路塔防</h1>
        <p class="intro-copy">
          每一座防御塔都会改变地形。你需要一边建设火力，一边通过堵路重塑敌人的最短路径，在不断升级的波次中尽量存活更久。
        </p>
        <div class="intro-rules">
          <h2>核心规则</h2>
          <ul>
            <li>敌人从多个出发点出发，分别计算到终点的最短路径。</li>
            <li>所有防御塔都会堵路，放置后会立刻改变敌人寻路。</li>
            <li>如果你堵死了所有正常路线，敌人会集中拆出一条强制通路。</li>
            <li>战斗中不能再建塔，但可以放置地图道具进行临场救火。</li>
            <li>每波结束可进入商店，购买永久道具、战斗道具或临时强化。</li>
            <li>核心生命归零，或场上敌人数失控达到崩溃上限时失败。</li>
          </ul>
        </div>
        <div class="intro-actions">
          <button id="enter-game" class="primary intro-start">开始游戏</button>
        </div>
      </div>
    </section>
  </div>
`;

const board = document.querySelector<HTMLDivElement>("#board")!;
const statsEl = document.querySelector<HTMLDivElement>("#stats")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const selectedInfoEl = document.querySelector<HTMLDivElement>("#selected-info")!;
const towerBarEl = document.querySelector<HTMLDivElement>("#tower-bar")!;
const inventoryEl = document.querySelector<HTMLDivElement>("#inventory")!;
const shopEl = document.querySelector<HTMLDivElement>("#shop")!;
const shopPanelEl = document.querySelector<HTMLElement>("#shop-panel")!;
const startWaveBtn = document.querySelector<HTMLButtonElement>("#start-wave")!;
const repairBtn = document.querySelector<HTMLButtonElement>("#repair-all")!;
const shopCloseBtn = document.querySelector<HTMLButtonElement>("#shop-close")!;
const introEl = document.querySelector<HTMLElement>("#intro-screen")!;
const enterGameBtn = document.querySelector<HTMLButtonElement>("#enter-game")!;

let hoveredCell: { x: number; y: number } | null = null;
let selectedTowerId: number | null = null;
let previousPhase = game.phase;
let previousInventoryKey = "";
let previousShopKey = "";
let previousSelectedTower = game.selectedTower;
let previousSelectedItem = game.selectedItem;

function buildGrid() {
  board.innerHTML = "";
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.style.left = `${x * CELL_SIZE}px`;
      cell.style.top = `${y * CELL_SIZE}px`;
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.addEventListener("mouseenter", () => {
        hoveredCell = { x, y };
        renderDynamic();
      });
      cell.addEventListener("mouseleave", () => {
        hoveredCell = null;
        renderDynamic();
      });
      cell.addEventListener("click", () => onCellClick(x, y));
      board.appendChild(cell);
    }
  }
}

function onCellClick(x: number, y: number) {
  const cell = game.cellStatus(x, y);
  if (cell.tower) {
    selectedTowerId = cell.tower.id;
    renderDynamic();
    return;
  }
  selectedTowerId = null;
  if (game.selectedItem) {
    game.placeInventoryItem(game.selectedItem, x, y);
    renderFull();
    return;
  }
  if (game.selectedTower) {
    game.placeTower(game.selectedTower, x, y);
    renderFull();
  }
}

function renderStats() {
  statsEl.innerHTML = `
    <div><strong>波次</strong><span>${game.wave}</span></div>
    <div><strong>金币</strong><span>${game.gold}</span></div>
    <div><strong>核心</strong><span>${game.coreHp}</span></div>
    <div><strong>敌人数</strong><span>${game.enemies.length}</span></div>
    <div><strong>路径</strong><span>${game.pathBundle.phase === "forced" ? "强制突破" : "正常寻路"}</span></div>
  `;

  const overload = game.enemies.length > 150 ? `${Math.ceil(10 - game.overloadCounter)} 秒后崩溃` : "稳定";
  statusEl.innerHTML = `
    <p class="message">${game.message}</p>
    <p>阶段：<strong>${labelPhase(game.phase)}</strong></p>
    <p>多个出发点会分别寻路，所有防御塔都会堵路。</p>
    <p>突破策略：${game.breakthroughPlan.summary}</p>
    <p>过载状态：${overload}</p>
    <p>强制通路触发：${game.stats.forcedCount} 次</p>
    <p>击杀总数：${game.stats.kills}</p>
  `;
}

function renderBoard() {
  const cells = board.querySelectorAll<HTMLButtonElement>(".cell");
  cells.forEach((cell) => {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    const status = game.cellStatus(x, y);
    cell.className = "cell";
    cell.innerHTML = "";
    if (status.isWall) cell.classList.add("wall");
    if (!status.isWall && !status.isBuildable && !status.isCore && status.spawnIndex < 0 && !status.fragileWall) cell.classList.add("road");
    if (status.isBuildable && !status.tower && !status.item && !status.isCore && status.spawnIndex < 0) cell.classList.add("buildable");
    if (status.isDanger) cell.classList.add("danger");
    if (status.isCore) {
      cell.classList.add("core");
      cell.textContent = "核";
    }
    if (status.spawnIndex >= 0) {
      cell.classList.add("spawn");
      cell.textContent = `S${status.spawnIndex + 1}`;
    }
    if (status.isPath) cell.classList.add("path");
    if (status.isBreach) cell.classList.add("breach");
    if (status.isKeyBlocker) cell.classList.add("key-blocker");
    if (hoveredCell && hoveredCell.x === x && hoveredCell.y === y) cell.classList.add("hover");
    if (status.tower && status.tower.id === selectedTowerId) cell.classList.add("selected-tower");

    if (status.tower) {
      const tower = status.tower;
      const maxHp = game.maxTowerHp(tower);
      const hpPct = Math.max(0, Math.min(100, Math.round((tower.hp / maxHp) * 100)));
      cell.classList.add("occupied");
      cell.style.setProperty("--accent", TOWERS[tower.type].color);
      cell.innerHTML = `
        <div class="occupant tower">
          <span class="tag">${TOWERS[tower.type].short}${tower.level}</span>
          <span class="hp"><i style="width:${hpPct}%"></i></span>
        </div>
      `;
    } else if (status.item) {
      const item = status.item;
      const cfg = ITEMS[item.type];
      const hpPct = cfg.maxHp && item.hp !== undefined ? Math.max(0, Math.min(100, Math.round((item.hp / cfg.maxHp) * 100))) : 100;
      cell.classList.add("occupied");
      cell.style.setProperty("--accent", cfg.color);
      cell.innerHTML = `
        <div class="occupant item">
          <span class="tag item-tag">${cfg.name.slice(0, 2)}</span>
          ${cfg.maxHp ? `<span class="hp"><i style="width:${hpPct}%"></i></span>` : ""}
        </div>
      `;
    } else if (status.fragileWall) {
      const wall = status.fragileWall;
      const hpPct = Math.max(0, Math.min(100, Math.round((wall.hp / wall.maxHp) * 100)));
      cell.classList.add("occupied", "fragile-wall");
      cell.innerHTML = `
        <div class="occupant item">
          <span class="tag item-tag fragile-tag">W</span>
          <span class="hp"><i style="width:${hpPct}%"></i></span>
        </div>
      `;
    }
  });

  board.querySelectorAll(".enemy").forEach((node) => node.remove());
  board.querySelectorAll(".range-ring").forEach((node) => node.remove());

  const selectedTower = selectedTowerId ? game.towers.find((entry) => entry.id === selectedTowerId) : undefined;
  if (selectedTower) {
    const stats = getTowerStats(selectedTower.type, selectedTower.level);
    const rangeRing = document.createElement("div");
    const radius = stats.range * CELL_SIZE;
    rangeRing.className = "range-ring";
    rangeRing.style.width = `${radius * 2}px`;
    rangeRing.style.height = `${radius * 2}px`;
    rangeRing.style.left = `${selectedTower.x * CELL_SIZE + CELL_SIZE / 2 - radius}px`;
    rangeRing.style.top = `${selectedTower.y * CELL_SIZE + CELL_SIZE / 2 - radius}px`;
    rangeRing.style.setProperty("--accent", TOWERS[selectedTower.type].color);
    board.appendChild(rangeRing);
  }

  game.enemies.forEach((enemy) => {
    const node = document.createElement("div");
    node.className = "enemy";
    node.style.left = `${enemy.x * CELL_SIZE + CELL_SIZE / 2}px`;
    node.style.top = `${enemy.y * CELL_SIZE + CELL_SIZE / 2}px`;
    node.style.background = ENEMIES[enemy.type].color;
    node.textContent = ENEMIES[enemy.type].boss ? "首" : ENEMIES[enemy.type].name[0];
    board.appendChild(node);
  });
}

function renderTowerBar() {
  const order: TowerType[] = ["gun", "sniper", "cannon", "slow", "support", "fortress"];
  towerBarEl.innerHTML = "";
  order.forEach((type) => {
    const tower = TOWERS[type];
    const btn = document.createElement("button");
    btn.className = `tower-card ${game.selectedTower === type && !game.selectedItem ? "active" : ""}`;
    btn.style.setProperty("--accent", tower.color);
    btn.disabled = game.phase !== "prep";
    btn.innerHTML = `
      <strong>${tower.name}</strong>
      <span>${tower.description}</span>
      <em>${tower.levels[0].cost} 金币</em>
    `;
    btn.addEventListener("click", () => {
      game.selectedTower = type;
      game.selectedItem = null;
      renderFull();
    });
    towerBarEl.appendChild(btn);
  });
}

function renderInventory() {
  inventoryEl.innerHTML = "";
  if (!game.inventory.length) {
    inventoryEl.innerHTML = `<p class="muted">波后在商店购买地图道具。战斗中只能使用战斗型道具。</p>`;
    return;
  }
  game.inventory.forEach((entry) => {
    const cfg = ITEMS[entry.type];
    const disabledByPhase =
      (game.phase === "battle" && cfg.usableDuring === "prep") ||
      ((game.phase === "prep" || game.phase === "shop") && cfg.usableDuring === "battle");
    const btn = document.createElement("button");
    btn.className = `inventory-card ${game.selectedItem === entry.type ? "active" : ""}`;
    btn.style.setProperty("--accent", cfg.color);
    btn.disabled = game.phase === "shop" || game.phase === "defeat" || disabledByPhase;
    btn.innerHTML = `
      <strong>${cfg.name}</strong>
      <span>${entry.quantity} 个</span>
      <small>${cfg.description}</small>
    `;
    btn.addEventListener("click", () => {
      game.selectedItem = entry.type;
      game.selectedTower = null;
      renderFull();
    });
    inventoryEl.appendChild(btn);
  });
}

function renderShop() {
  if (game.phase !== "shop") {
    shopEl.innerHTML = `<p class="muted">波次结束后，可在这里购买永久型与战斗型地图道具。</p>`;
    return;
  }
  shopEl.innerHTML = "";
  game.shopOffers.forEach((offer) => {
    const btn = document.createElement("button");
    btn.className = "shop-card";
    btn.disabled = game.gold < offer.price;
    btn.innerHTML = `
      <strong>${offer.name}</strong>
      <span>${offer.description}</span>
      <em>${offer.price} 金币</em>
    `;
    btn.addEventListener("click", () => {
      game.buyOffer(offer.id);
      renderFull();
    });
    shopEl.appendChild(btn);
  });
  const reroll = document.createElement("button");
  reroll.className = "ghost";
  reroll.textContent = "刷新商店";
  reroll.addEventListener("click", () => {
    game.rerollShop();
    renderFull();
  });
  shopEl.appendChild(reroll);
}

function renderSelected() {
  if (!selectedTowerId) {
    selectedInfoEl.innerHTML = `<p class="muted">点击地图中的防御塔查看升级、出售和维修成本。</p>`;
    return;
  }
  const tower = game.towers.find((entry) => entry.id === selectedTowerId);
  if (!tower) {
    selectedTowerId = null;
    selectedInfoEl.innerHTML = `<p class="muted">点击地图中的防御塔查看升级、出售和维修成本。</p>`;
    return;
  }
  const maxHp = game.maxTowerHp(tower);
  const sellValue = game.sellValue(tower);
  selectedInfoEl.innerHTML = `
    <div class="selected-card">
      <h3>${TOWERS[tower.type].name} Lv${tower.level}</h3>
      <p>生命：${tower.hp} / ${maxHp}</p>
      <p>攻击范围：${getTowerStats(tower.type, tower.level).range.toFixed(1)} 格</p>
      <p>维修：${game.repairCost(tower)} 金币</p>
      <p>拆除返还：${sellValue} 金币</p>
      <div class="selected-actions">
        <button id="upgrade-selected" ${game.phase !== "prep" || tower.level >= 3 ? "disabled" : ""}>升级</button>
        <button id="sell-selected" ${game.phase !== "prep" ? "disabled" : ""}>拆除返还</button>
      </div>
    </div>
  `;
  document.querySelector<HTMLButtonElement>("#upgrade-selected")?.addEventListener("click", () => {
    game.upgradeTower(tower.id);
    renderFull();
  });
  document.querySelector<HTMLButtonElement>("#sell-selected")?.addEventListener("click", () => {
    game.sellTower(tower.id);
    selectedTowerId = null;
    renderFull();
  });
}

function renderDynamic() {
  renderStats();
  renderBoard();
  renderSelected();
  startWaveBtn.hidden = game.phase === "battle" || game.phase === "shop" || game.phase === "defeat";
  repairBtn.hidden = game.phase !== "prep";
  shopCloseBtn.hidden = game.phase !== "shop";
  shopPanelEl.hidden = game.phase !== "shop";
  introEl.hidden = !introVisible;
}

function renderStaticPanels() {
  renderTowerBar();
  renderInventory();
  renderShop();
}

function renderFull() {
  renderDynamic();
  renderStaticPanels();
  previousPhase = game.phase;
  previousInventoryKey = inventoryKey();
  previousShopKey = shopKey();
  previousSelectedTower = game.selectedTower;
  previousSelectedItem = game.selectedItem;
}

function refreshStaticIfNeeded() {
  const currentInventoryKey = inventoryKey();
  const currentShopKey = shopKey();
  const towerSelectionChanged = previousSelectedTower !== game.selectedTower;
  const itemSelectionChanged = previousSelectedItem !== game.selectedItem;
  const phaseChanged = previousPhase !== game.phase;

  if (
    phaseChanged ||
    towerSelectionChanged ||
    itemSelectionChanged ||
    previousInventoryKey !== currentInventoryKey ||
    previousShopKey !== currentShopKey
  ) {
    renderStaticPanels();
    previousPhase = game.phase;
    previousInventoryKey = currentInventoryKey;
    previousShopKey = currentShopKey;
    previousSelectedTower = game.selectedTower;
    previousSelectedItem = game.selectedItem;
  }
}

function labelPhase(phase: string) {
  if (phase === "prep") return "准备阶段";
  if (phase === "battle") return "战斗阶段";
  if (phase === "shop") return "商店阶段";
  return "失败结算";
}

startWaveBtn.addEventListener("click", () => {
  game.startWave();
  renderFull();
});

repairBtn.addEventListener("click", () => {
  game.repairAll();
  renderFull();
});

shopCloseBtn.addEventListener("click", () => {
  game.closeShop();
  renderFull();
});

enterGameBtn.addEventListener("click", () => {
  introVisible = false;
  renderDynamic();
});

buildGrid();
renderFull();

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  renderDynamic();
  refreshStaticIfNeeded();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

function inventoryKey() {
  return game.inventory
    .map((entry) => `${entry.type}:${entry.quantity}`)
    .sort()
    .join("|");
}

function shopKey() {
  return game.shopOffers
    .map((offer) => `${offer.id}:${offer.type}:${offer.price}`)
    .sort()
    .join("|");
}
