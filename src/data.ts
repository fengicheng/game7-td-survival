import type {
  EnemyConfig,
  EnemyType,
  FragileWallEntity,
  ItemConfig,
  ItemType,
  Point,
  ShopOffer,
  TowerConfig,
  TowerType,
  WaveSpawn,
} from "./types";

const MAP_LAYOUT = [
  "#####################",
  "##########S##########",
  "#S=++====+=!===++=###",
  "#=###=###=.=###=.=###",
  "#=...=..+...=..+==###",
  "#=###=##+++##=###+###",
  "#=W+=..+++..=!!+=####",
  "#=W+====+++====++=###",
  "#=W+=..+++..=!!+=####",
  "#=###=##+++##=###+###",
  "#=...=..+...=..+==###",
  "#=###=###=.=###=.=###",
  "#S=++====+=!===++=+C#",
  "#####################",
  "#####################",
] as const;

export const GRID_WIDTH = MAP_LAYOUT[0].length;
export const GRID_HEIGHT = MAP_LAYOUT.length;
export const CELL_SIZE = 44;
export const BOARD_WIDTH = GRID_WIDTH * CELL_SIZE;
export const BOARD_HEIGHT = GRID_HEIGHT * CELL_SIZE;
export const INITIAL_GOLD = 400;
export const INITIAL_CORE_HP = 20;
export const OVERLOAD_LIMIT = 150;
export const OVERLOAD_SECONDS = 10;
export const FRAGILE_WALL_HP = 780;
export const FRAGILE_WALL_ARMOR = 6;
export const DANGER_DAMAGE_PER_SECOND = 16;
export const DANGER_PATH_PENALTY = 0.75;
export const GLOBAL_ENEMY_HP_MULTIPLIER = 2;
export const GLOBAL_ENEMY_SPEED_MULTIPLIER = 1.15;

export const TERRAIN_WALLS = new Set<string>();
export const BUILDABLE_TILES = new Set<string>();
export const DANGER_TILES = new Set<string>();
export const ROAD_TILES = new Set<string>();
export const FRAGILE_WALL_TILES = new Set<string>();
export const SPAWNS: Point[] = [];
export let CORE: Point = { x: 0, y: 0 };

MAP_LAYOUT.forEach((row, y) => {
  if (row.length !== GRID_WIDTH) {
    throw new Error(`Invalid map row width at y=${y}`);
  }
  row.split("").forEach((tile, x) => {
    const key = `${x},${y}`;
    if (tile === "#") TERRAIN_WALLS.add(key);
    if (tile === "+" || tile === ".") BUILDABLE_TILES.add(key);
    if (tile === "=" || tile === "!") ROAD_TILES.add(key);
    if (tile === "!") DANGER_TILES.add(key);
    if (tile === "W") FRAGILE_WALL_TILES.add(key);
    if (tile === "S") SPAWNS.push({ x, y });
    if (tile === "C") CORE = { x, y };
  });
});

export function terrainAt(x: number, y: number) {
  return MAP_LAYOUT[y]?.[x] ?? "#";
}

export function createFragileWalls(startId: number): FragileWallEntity[] {
  let currentId = startId;
  return [...FRAGILE_WALL_TILES].map((key) => {
    const [x, y] = key.split(",").map(Number);
    currentId += 1;
    return {
      id: currentId,
      x,
      y,
      hp: FRAGILE_WALL_HP,
      maxHp: FRAGILE_WALL_HP,
      armor: FRAGILE_WALL_ARMOR,
    };
  });
}

export const TOWERS: Record<TowerType, TowerConfig> = {
  gun: {
    name: "机枪塔",
    short: "枪",
    color: "#f6b756",
    description: "中射程高攻速，清理轻型敌人。",
    levels: [
      { cost: 60, maxHp: 220, armor: 4, damage: 16, cooldown: 0.45, range: 3.2, repairFactor: 1.0 },
      { cost: 70, maxHp: 320, armor: 6, damage: 24, cooldown: 0.42, range: 3.4, repairFactor: 0.98 },
      { cost: 90, maxHp: 450, armor: 8, damage: 36, cooldown: 0.4, range: 3.6, repairFactor: 0.95 },
    ],
  },
  sniper: {
    name: "狙击塔",
    short: "狙",
    color: "#65c7ff",
    description: "长射程高单伤，擅长处理精英。",
    levels: [
      { cost: 85, maxHp: 160, armor: 2, damage: 60, cooldown: 1.5, range: 5.5, repairFactor: 1.15 },
      { cost: 95, maxHp: 230, armor: 3, damage: 95, cooldown: 1.45, range: 6, repairFactor: 1.12 },
      { cost: 120, maxHp: 320, armor: 4, damage: 145, cooldown: 1.4, range: 6.5, repairFactor: 1.1 },
    ],
  },
  cannon: {
    name: "炮台塔",
    short: "炮",
    color: "#ff845f",
    description: "范围伤害，适合守拐点与汇流区。",
    levels: [
      { cost: 95, maxHp: 260, armor: 3, damage: 48, cooldown: 1.8, range: 3.4, splash: 1, repairFactor: 1.02 },
      { cost: 105, maxHp: 360, armor: 5, damage: 78, cooldown: 1.7, range: 3.6, splash: 1.2, repairFactor: 1.0 },
      { cost: 135, maxHp: 500, armor: 7, damage: 120, cooldown: 1.6, range: 3.8, splash: 1.3, repairFactor: 0.98 },
    ],
  },
  slow: {
    name: "减速塔",
    short: "缓",
    color: "#88f4db",
    description: "持续减速拖线，扩大火力窗口。",
    levels: [
      { cost: 75, maxHp: 240, armor: 3, damage: 8, cooldown: 1, range: 3.5, slowPct: 0.25, slowDuration: 1.2, repairFactor: 1.05 },
      { cost: 85, maxHp: 330, armor: 4, damage: 14, cooldown: 1, range: 4, slowPct: 0.35, slowDuration: 1.4, repairFactor: 1.03 },
      { cost: 110, maxHp: 450, armor: 6, damage: 22, cooldown: 0.9, range: 4.5, slowPct: 0.45, slowDuration: 1.6, repairFactor: 1.0 },
    ],
  },
  support: {
    name: "支援塔",
    short: "辅",
    color: "#c7a6ff",
    description: "提供攻速、攻击与维修折扣光环。",
    levels: [
      { cost: 90, maxHp: 200, armor: 2, damage: 0, cooldown: 999, range: 0, auraRange: 2.5, auraSpeedBonus: 0.12, repairFactor: 1.18 },
      { cost: 100, maxHp: 280, armor: 3, damage: 0, cooldown: 999, range: 0, auraRange: 3, auraSpeedBonus: 0.18, auraRepairDiscount: 0.08, repairFactor: 1.15 },
      { cost: 130, maxHp: 380, armor: 4, damage: 0, cooldown: 999, range: 0, auraRange: 3.5, auraSpeedBonus: 0.25, auraAttackBonus: 0.1, auraRepairDiscount: 0.12, repairFactor: 1.12 },
    ],
  },
  fortress: {
    name: "堡垒塔",
    short: "垒",
    color: "#8d93a8",
    description: "最高承伤能力，最适合顶在突破口。",
    levels: [
      { cost: 70, maxHp: 520, armor: 10, damage: 10, cooldown: 1.2, range: 1.2, repairFactor: 0.78 },
      { cost: 85, maxHp: 760, armor: 15, damage: 16, cooldown: 1.1, range: 1.2, repairFactor: 0.74 },
      { cost: 110, maxHp: 1100, armor: 22, damage: 24, cooldown: 1, range: 1.4, repairFactor: 0.7 },
    ],
  },
};

export const ENEMIES: Record<EnemyType, EnemyConfig> = {
  light: {
    name: "轻型步兵",
    color: "#f4db6c",
    hp: 70,
    armor: 0,
    speed: 1,
    towerDamage: 14,
    attackCooldown: 1.1,
    attackRange: 1,
    coreDamage: 1,
    gold: 8,
    pathWeights: { length: 1.0, fire: 1.3, control: 1.2, danger: 1.2, structure: 1.4, wall: 1.3 },
  },
  heavy: {
    name: "重装兵",
    color: "#d47070",
    hp: 220,
    armor: 8,
    speed: 0.75,
    towerDamage: 38,
    attackCooldown: 1.8,
    attackRange: 1,
    coreDamage: 1,
    gold: 16,
    pathWeights: { length: 1.0, fire: 0.9, control: 1.3, danger: 1.0, structure: 1.0, wall: 1.0 },
  },
  engineer: {
    name: "工程兵",
    color: "#ff9e6d",
    hp: 155,
    armor: 2,
    speed: 0.95,
    towerDamage: 56,
    attackCooldown: 1,
    attackRange: 1,
    coreDamage: 1,
    gold: 18,
    activeSaboteur: true,
    pathWeights: { length: 1.0, fire: 0.85, control: 1.0, danger: 1.0, structure: 0.65, wall: 0.55 },
  },
  beast: {
    name: "狂暴兽",
    color: "#8ef7a1",
    hp: 150,
    armor: 1,
    speed: 1.25,
    towerDamage: 22,
    attackCooldown: 0.8,
    attackRange: 1,
    coreDamage: 1,
    gold: 14,
    frenzy: true,
    pathWeights: { length: 1.35, fire: 0.95, control: 1.05, danger: 1.0, structure: 0.9, wall: 1.0 },
  },
  destroyer: {
    name: "远程破坏者",
    color: "#8fc2ff",
    hp: 145,
    armor: 1,
    speed: 0.9,
    towerDamage: 28,
    attackCooldown: 1.4,
    attackRange: 3.5,
    coreDamage: 2,
    gold: 20,
    rangedBreaker: true,
    pathWeights: { length: 1.0, fire: 1.15, control: 1.0, danger: 1.0, structure: 0.85, wall: 0.9 },
  },
  boss: {
    name: "Boss",
    color: "#ff4e5f",
    hp: 2000,
    armor: 14,
    speed: 0.8,
    towerDamage: 65,
    attackCooldown: 1.5,
    attackRange: 1.2,
    coreDamage: 5,
    gold: 120,
    boss: true,
    activeSaboteur: true,
    pathWeights: { length: 0.9, fire: 0.8, control: 0.9, danger: 0.9, structure: 0.55, wall: 0.5 },
  },
};

export const ITEMS: Record<ItemType, ItemConfig> = {
  roadblock: { name: "临时路障", color: "#b07a60", price: 35, description: "战斗中可放置的低耐久阻挡物，持续 18 秒。", blocking: true, usableDuring: "battle", duration: 18, maxHp: 180, armor: 2 },
  wire: { name: "铁丝网", color: "#7fd7ff", price: 25, description: "战斗中放置，使敌人经过该格时减速。", blocking: false, usableDuring: "battle", duration: 25, slowPct: 0.35 },
  mine: { name: "地雷", color: "#ffd36f", price: 30, description: "敌人靠近时触发一次性爆炸。", blocking: false, usableDuring: "battle", damage: 180 },
  barrel: { name: "爆炸桶", color: "#ff8f6b", price: 40, description: "可被击中或接触后爆炸的高伤道具。", blocking: false, usableDuring: "battle", maxHp: 60, armor: 0, damage: 260 },
  decoy: { name: "诱饵装置", color: "#b288ff", price: 45, description: "短时间吸引工程兵和远程破坏者优先攻击。", blocking: false, usableDuring: "battle", duration: 6, maxHp: 120, armor: 1 },
  repairStation: { name: "维修站", color: "#77f1d3", price: 80, description: "准备阶段放置，波间修复周围塔体。", blocking: false, usableDuring: "prep", maxHp: 160, armor: 2 },
  energyNode: { name: "能量节点", color: "#64d8ff", price: 95, description: "准备阶段放置，提升周围塔攻速。", blocking: false, usableDuring: "prep", maxHp: 150, armor: 2, auraSpeedBonus: 0.1 },
  fireBeacon: { name: "火力信标", color: "#ff7d76", price: 105, description: "准备阶段放置，提升周围塔攻击。", blocking: false, usableDuring: "prep", maxHp: 170, armor: 3, auraAttackBonus: 0.18 },
  reinforcedWall: { name: "加固路障", color: "#9f8f85", price: 65, description: "准备阶段放置的承伤阻挡物。", blocking: true, usableDuring: "prep", maxHp: 260, armor: 5 },
};

const SHOP_SPECIALS = [
  { type: "credit" as const, name: "紧急补给", description: "立即获得 60 金币。", price: 50 },
  { type: "repairDiscount" as const, name: "维修折扣", description: "下次批量维修费用降低 25%。", price: 45 },
  { type: "towerBoost" as const, name: "火力扩容", description: "下 1 波所有塔攻击提升 10%。", price: 70 },
  { type: "fortify" as const, name: "工事加固", description: "下 1 波所有塔生命提高 15%。", price: 65 },
];

export function getTowerStats(type: TowerType, level: 1 | 2 | 3) {
  return TOWERS[type].levels[level - 1];
}

export function getWaveBudget(wave: number) {
  return 21 + 7 * wave + 10 * Math.floor(wave / 5);
}

export function getEnemyMultiplier(wave: number) {
  return {
    hp: 1 + 0.06 * (wave - 1) + 0.04 * Math.floor((wave - 1) / 5),
    armor: Math.floor((wave - 1) / 6),
    speed: 1 + 0.02 * Math.floor((wave - 1) / 5),
    towerDamage: 1 + 0.05 * Math.floor((wave - 1) / 4),
    gold: 1 + 0.04 * (wave - 1),
  };
}

const ENEMY_COSTS: Record<EnemyType, number> = { light: 1, heavy: 3, engineer: 3, beast: 3, destroyer: 4, boss: 15 };

function availableEnemyTypes(wave: number): EnemyType[] {
  const types: EnemyType[] = ["light"];
  if (wave >= 3) types.push("heavy");
  if (wave >= 3) types.push("beast");
  if (wave >= 5) types.push("engineer");
  if (wave >= 7) types.push("destroyer");
  if (wave >= 10 && wave % 10 === 0) types.push("boss");
  return types;
}

export function generateWave(wave: number): WaveSpawn[] {
  const budget = getWaveBudget(wave);
  const types = availableEnemyTypes(wave);
  const picks: EnemyType[] = [];
  let remaining = budget;

  if (wave >= 10 && wave % 10 === 0 && remaining >= ENEMY_COSTS.boss) {
    picks.push("boss");
    remaining -= ENEMY_COSTS.boss;
  }

  while (remaining > 0) {
    const affordable = types.filter((type) => ENEMY_COSTS[type] <= remaining && type !== "boss");
    if (!affordable.length) break;
    const weighted = affordable.flatMap((type) => Array.from({ length: type === "light" ? 6 : type === "heavy" ? 3 : type === "beast" ? 3 : 2 }, () => type));
    const choice = weighted[Math.floor(Math.random() * weighted.length)];
    picks.push(choice);
    remaining -= ENEMY_COSTS[choice];
  }

  const spawns: WaveSpawn[] = [];
  let timer = 0;
  picks.forEach((type, index) => {
    if (index !== 0) timer += type === "boss" ? 2 : 0.45 + Math.random() * 0.3;
    const spawnId = type === "boss" ? wave % SPAWNS.length : Math.floor(Math.random() * SPAWNS.length);
    spawns.push({ time: timer, spawnId, type });
  });

  return spawns.sort((a, b) => a.time - b.time);
}

export function rollShopOffers(seed: number): ShopOffer[] {
  const itemTypes = Object.keys(ITEMS) as ItemType[];
  const offers: ShopOffer[] = [];
  const rand = mulberry32(seed);

  while (offers.length < 4) {
    if (rand() < 0.72) {
      const type = itemTypes[Math.floor(rand() * itemTypes.length)];
      const config = ITEMS[type];
      offers.push({ id: offers.length + 1, type, name: config.name, description: config.description, price: config.price });
      continue;
    }
    const special = SHOP_SPECIALS[Math.floor(rand() * SHOP_SPECIALS.length)];
    offers.push({ id: offers.length + 1, ...special });
  }

  return offers;
}

function mulberry32(seed: number) {
  let t = seed;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
