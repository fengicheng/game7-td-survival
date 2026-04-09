import "./styles.css";
import { BOARD_HEIGHT, BOARD_WIDTH, CELL_SIZE, ENEMIES, GRID_HEIGHT, GRID_WIDTH, ITEMS, TOWERS } from "./data";
import { GameState } from "./game";
import type { TowerType } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const game = new GameState();

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

let hoveredCell: { x: number; y: number } | null = null;
let selectedTowerId: number | null = null;

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
        render();
      });
      cell.addEventListener("mouseleave", () => {
        hoveredCell = null;
        render();
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
    render();
    return;
  }
  if (game.selectedItem) {
    game.placeInventoryItem(game.selectedItem, x, y);
    render();
    return;
  }
  if (game.selectedTower) {
    game.placeTower(game.selectedTower, x, y);
    render();
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
    if (status.isBuildable && !status.tower && !status.item && !status.isCore && status.spawnIndex < 0) cell.classList.add("buildable");
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
    }
  });

  board.querySelectorAll(".enemy").forEach((node) => node.remove());
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
      render();
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
      render();
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
      render();
    });
    shopEl.appendChild(btn);
  });
  const reroll = document.createElement("button");
  reroll.className = "ghost";
  reroll.textContent = "刷新商店";
  reroll.addEventListener("click", () => {
    game.rerollShop();
    render();
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
  selectedInfoEl.innerHTML = `
    <div class="selected-card">
      <h3>${TOWERS[tower.type].name} Lv${tower.level}</h3>
      <p>生命：${tower.hp} / ${maxHp}</p>
      <p>维修：${game.repairCost(tower)} 金币</p>
      <div class="selected-actions">
        <button id="upgrade-selected" ${game.phase !== "prep" || tower.level >= 3 ? "disabled" : ""}>升级</button>
        <button id="sell-selected" ${game.phase !== "prep" ? "disabled" : ""}>出售</button>
      </div>
    </div>
  `;
  document.querySelector<HTMLButtonElement>("#upgrade-selected")?.addEventListener("click", () => {
    game.upgradeTower(tower.id);
    render();
  });
  document.querySelector<HTMLButtonElement>("#sell-selected")?.addEventListener("click", () => {
    game.sellTower(tower.id);
    selectedTowerId = null;
    render();
  });
}

function render() {
  renderStats();
  renderBoard();
  renderTowerBar();
  renderInventory();
  renderShop();
  renderSelected();
  startWaveBtn.hidden = game.phase === "battle" || game.phase === "shop" || game.phase === "defeat";
  repairBtn.hidden = game.phase !== "prep";
  shopCloseBtn.hidden = game.phase !== "shop";
  shopPanelEl.hidden = game.phase !== "shop";
}

function labelPhase(phase: string) {
  if (phase === "prep") return "准备阶段";
  if (phase === "battle") return "战斗阶段";
  if (phase === "shop") return "商店阶段";
  return "失败结算";
}

startWaveBtn.addEventListener("click", () => {
  game.startWave();
  render();
});

repairBtn.addEventListener("click", () => {
  game.repairAll();
  render();
});

shopCloseBtn.addEventListener("click", () => {
  game.closeShop();
  render();
});

buildGrid();
render();

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
