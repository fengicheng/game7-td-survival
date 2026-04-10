import { CORE, ENEMIES, GRID_HEIGHT, GRID_WIDTH, ITEMS, SPAWNS, getTowerStats } from "./data";
import type { EnemyType, FragileWallEntity, ItemEntity, PathBundle, Point, TowerEntity } from "./types";

interface Occupancy {
  towers: Map<string, TowerEntity>;
  items: Map<string, ItemEntity>;
  fragileWalls: Map<string, FragileWallEntity>;
  walls: Set<string>;
  danger: Set<string>;
}

interface InfluenceMaps {
  fire: Map<string, number>;
  control: Map<string, number>;
}

interface SearchNode extends Point {
  g: number;
  f: number;
  steps: number;
  turns: number;
  dir: string;
}

interface SearchResult {
  path: Point[];
  cost: number;
}

const REPRESENTATIVE_TYPE: EnemyType = "light";
const NO_PATH_COST = Number.POSITIVE_INFINITY;
const PREFERRED_PATH_PENALTY = 0.35;

const DIRS = [
  { x: 1, y: 0, key: "R" },
  { x: -1, y: 0, key: "L" },
  { x: 0, y: 1, key: "D" },
  { x: 0, y: -1, key: "U" },
];

export function toKey(x: number, y: number) {
  return `${x},${y}`;
}

export function isInside(x: number, y: number) {
  return x >= 0 && y >= 0 && x < GRID_WIDTH && y < GRID_HEIGHT;
}

function routeKey(spawnId: number, enemyType: EnemyType) {
  return `${spawnId}:${enemyType}`;
}

function stateKey(x: number, y: number, dir: string) {
  return `${x},${y}|${dir}`;
}

function reconstruct(endKey: string, parents: Map<string, string>) {
  const path: Point[] = [];
  let key = endKey;
  while (key) {
    const [point] = key.split("|");
    const [x, y] = point.split(",").map(Number);
    path.unshift({ x, y });
    key = parents.get(key) ?? "";
  }
  return path;
}

function isBlockingItem(item?: ItemEntity) {
  return item?.type === "roadblock" || item?.type === "reinforcedWall";
}

function structureAt(key: string, occupancy: Occupancy) {
  const tower = occupancy.towers.get(key);
  if (tower) return { kind: "tower" as const, tower };
  const item = occupancy.items.get(key);
  if (isBlockingItem(item)) return { kind: "item" as const, item: item! };
  const wall = occupancy.fragileWalls.get(key);
  if (wall) return { kind: "wall" as const, wall };
  return undefined;
}

function buildInfluenceMaps(occupancy: Occupancy) {
  const fire = new Map<string, number>();
  const control = new Map<string, number>();
  const supportBoosts = new Map<number, { attack: number; speed: number }>();
  const towers = [...occupancy.towers.values()];

  towers.forEach((tower) => {
    if (tower.type !== "support") return;
    const aura = getTowerStats(tower.type, tower.level);
    const auraRange = aura.auraRange ?? 0;
    if (!auraRange) return;
    towers.forEach((target) => {
      if (target.id === tower.id || distance(tower, target) > auraRange) return;
      const current = supportBoosts.get(target.id) ?? { attack: 0, speed: 0 };
      current.attack += aura.auraAttackBonus ?? 0;
      current.speed += aura.auraSpeedBonus ?? 0;
      supportBoosts.set(target.id, current);
    });
  });

  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const key = toKey(x, y);
      let fireValue = 0;
      let controlValue = 0;

      towers.forEach((tower) => {
        const stats = getTowerStats(tower.type, tower.level);
        const effectiveRange = stats.range > 0 ? stats.range : stats.auraRange ?? 0;
        if (effectiveRange <= 0 || distance({ x, y }, tower) > effectiveRange + 0.1) return;

        const support = supportBoosts.get(tower.id) ?? { attack: 0, speed: 0 };
        const multiplier = 1 + support.attack + support.speed;
        if (tower.type === "gun") fireValue += 0.6 * multiplier;
        else if (tower.type === "sniper") fireValue += 1.2 * multiplier;
        else if (tower.type === "cannon") fireValue += 1.5 * multiplier;
        else if (tower.type === "slow") {
          fireValue += 0.4 * multiplier;
          controlValue += 1.2;
        } else if (tower.type === "fortress") fireValue += 0.2;
      });

      const wire = occupancy.items.get(key);
      if (wire?.type === "wire") controlValue += 1.0;
      if (occupancy.danger.has(key)) fireValue += 0.8;

      if (fireValue > 0) fire.set(key, fireValue);
      if (controlValue > 0) control.set(key, controlValue);
    }
  }

  return { fire, control };
}

function heuristic(point: Point, enemyType: EnemyType) {
  return (Math.abs(point.x - CORE.x) + Math.abs(point.y - CORE.y)) * ENEMIES[enemyType].pathWeights.length;
}

function movementCost(
  point: Point,
  enemyType: EnemyType,
  occupancy: Occupancy,
  influence: InfluenceMaps,
  structure: ReturnType<typeof structureAt>,
  isTurn: boolean,
  preferred?: Set<string>,
) {
  const weights = ENEMIES[enemyType].pathWeights;
  const key = toKey(point.x, point.y);
  let cost = 1 * weights.length;
  if (isTurn) cost += 0.15 * weights.length;
  cost += (influence.fire.get(key) ?? 0) * weights.fire;
  cost += (influence.control.get(key) ?? 0) * weights.control;
  if (occupancy.danger.has(key)) cost += 2.5 * weights.danger;
  if (preferred && preferred.size > 0 && !preferred.has(key)) cost += PREFERRED_PATH_PENALTY;

  if (!structure) return cost;

  if (structure.kind === "wall") {
    return cost + wallBreakCost(structure.wall, enemyType);
  }

  if (structure.kind === "tower") {
    return cost + towerBreakCost(structure.tower, enemyType);
  }

  return cost + itemBreakCost(structure.item, enemyType);
}

function towerBreakCost(tower: TowerEntity, enemyType: EnemyType) {
  const weights = ENEMIES[enemyType].pathWeights;
  const stats = getTowerStats(tower.type, tower.level);
  const fixed =
    tower.type === "support"
      ? 8
      : tower.type === "slow"
        ? 7
        : tower.type === "fortress"
          ? 12
          : 6;
  const tactical =
    tower.type === "support"
      ? 3
      : tower.type === "slow"
        ? 2
        : tower.type === "fortress"
          ? 1
          : 0;
  const effectiveHp = tower.hp * (1 + stats.armor * 0.06);
  return (fixed + tactical + effectiveHp / breakEfficiency(enemyType)) * weights.structure;
}

function wallBreakCost(wall: FragileWallEntity, enemyType: EnemyType) {
  const weights = ENEMIES[enemyType].pathWeights;
  const effectiveHp = wall.hp * (1 + wall.armor * 0.05);
  return (8 + effectiveHp / breakEfficiency(enemyType)) * weights.wall;
}

function itemBreakCost(item: ItemEntity, enemyType: EnemyType) {
  const weights = ENEMIES[enemyType].pathWeights;
  const armor = ITEMS[item.type].armor ?? 0;
  const fixed = item.type === "reinforcedWall" ? 9 : 5;
  const effectiveHp = (item.hp ?? 0) * (1 + armor * 0.05);
  return (fixed + effectiveHp / breakEfficiency(enemyType)) * weights.structure;
}

function breakEfficiency(enemyType: EnemyType) {
  if (enemyType === "light") return 1.0;
  if (enemyType === "heavy") return 1.3;
  if (enemyType === "engineer") return 2.8;
  if (enemyType === "beast") return 1.4;
  if (enemyType === "destroyer") return 1.6;
  return 4.0;
}

function searchPath(
  start: Point,
  enemyType: EnemyType,
  occupancy: Occupancy,
  influence: InfluenceMaps,
  allowBreakStructures: boolean,
  preferred?: Set<string>,
): SearchResult {
  const startState = stateKey(start.x, start.y, "S");
  const open: SearchNode[] = [{ ...start, g: 0, f: heuristic(start, enemyType), steps: 0, turns: 0, dir: "S" }];
  const best = new Map<string, number>([[startState, 0]]);
  const parents = new Map<string, string>();

  while (open.length) {
    open.sort((a, b) => a.f - b.f || a.g - b.g || a.turns - b.turns || a.steps - b.steps || a.y - b.y || a.x - b.x);
    const current = open.shift()!;
    const currentState = stateKey(current.x, current.y, current.dir);
    const bestKnown = best.get(currentState);
    if (bestKnown !== undefined && current.g > bestKnown + 0.0001) continue;

    if (current.x === CORE.x && current.y === CORE.y) {
      return { path: reconstruct(currentState, parents), cost: current.g };
    }

    for (const dir of DIRS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (!isInside(nx, ny)) continue;
      const key = toKey(nx, ny);
      if (occupancy.walls.has(key)) continue;

      const structure = structureAt(key, occupancy);
      if (structure && !allowBreakStructures) continue;

      const turn = current.dir !== "S" && current.dir !== dir.key;
      const stepCost = movementCost({ x: nx, y: ny }, enemyType, occupancy, influence, structure, turn, preferred);
      const nextG = current.g + stepCost;
      const nextState = stateKey(nx, ny, dir.key);
      const prev = best.get(nextState);
      if (prev !== undefined && prev <= nextG) continue;

      best.set(nextState, nextG);
      parents.set(nextState, currentState);
      open.push({
        x: nx,
        y: ny,
        g: nextG,
        f: nextG + heuristic({ x: nx, y: ny }, enemyType),
        steps: current.steps + 1,
        turns: current.turns + (turn ? 1 : 0),
        dir: dir.key,
      });
    }
  }

  return { path: [], cost: NO_PATH_COST };
}

function blockedCellsInPath(path: Point[], occupancy: Occupancy) {
  const blockers = new Set<string>();
  path.forEach((point) => {
    const key = toKey(point.x, point.y);
    if (structureAt(key, occupancy)) blockers.add(key);
  });
  return blockers;
}

function pickBestDisplayPath(results: SearchResult[]) {
  const valid = results.filter((entry) => entry.path.length > 0);
  valid.sort((a, b) => a.cost - b.cost || a.path.length - b.path.length);
  return valid[0]?.path ?? [];
}

function buildOccupancy(
  towers: TowerEntity[],
  items: ItemEntity[],
  fragileWalls: FragileWallEntity[],
  walls: Set<string>,
  danger: Set<string>,
): Occupancy {
  return {
    towers: new Map(towers.map((tower) => [toKey(tower.x, tower.y), tower])),
    items: new Map(items.map((item) => [toKey(item.x, item.y), item])),
    fragileWalls: new Map(fragileWalls.map((wall) => [toKey(wall.x, wall.y), wall])),
    walls,
    danger,
  };
}

export function computeEnemyPathFromPoint(
  start: Point,
  enemyType: EnemyType,
  phase: PathBundle["phase"],
  towers: TowerEntity[],
  items: ItemEntity[],
  fragileWalls: FragileWallEntity[],
  walls: Set<string>,
  danger: Set<string>,
) {
  const occupancy = buildOccupancy(towers, items, fragileWalls, walls, danger);
  const influence = buildInfluenceMaps(occupancy);
  const normal = searchPath(start, enemyType, occupancy, influence, false);
  const forced = searchPath(start, enemyType, occupancy, influence, true);

  if (phase === "forced") return forced.path.length ? forced.path : normal.path;
  if (forced.path.length && forced.cost + 0.25 < normal.cost) return forced.path;
  return normal.path.length ? normal.path : forced.path;
}

export function computePathBundle(
  towers: TowerEntity[],
  items: ItemEntity[],
  fragileWalls: FragileWallEntity[],
  walls: Set<string>,
  danger: Set<string>,
): PathBundle {
  const occupancy = buildOccupancy(towers, items, fragileWalls, walls, danger);
  const influence = buildInfluenceMaps(occupancy);
  const enemyTypes = Object.keys(ENEMIES) as EnemyType[];

  const unitNormalPaths = new Map<string, Point[]>();
  const unitForcedPaths = new Map<string, Point[]>();
  const unitNormalCosts = new Map<string, number>();
  const unitForcedCosts = new Map<string, number>();
  const normalPaths = new Map<number, Point[]>();
  const forcedPaths = new Map<number, Point[]>();

  let allBlocked = true;
  SPAWNS.forEach((spawn, spawnId) => {
    const normal = searchPath(spawn, REPRESENTATIVE_TYPE, occupancy, influence, false);
    const forced = searchPath(spawn, REPRESENTATIVE_TYPE, occupancy, influence, true);
    if (normal.path.length > 0) {
      normalPaths.set(spawnId, normal.path);
      allBlocked = false;
    }
    if (forced.path.length > 0) forcedPaths.set(spawnId, forced.path);
  });

  const representativeForced = [...forcedPaths.values()];
  const breachPath = pickBestDisplayPath(
    representativeForced.map((path) => ({
      path,
      cost: path.length,
    })),
  );
  const preferred = allBlocked && breachPath.length ? new Set(breachPath.map((point) => toKey(point.x, point.y))) : undefined;

  SPAWNS.forEach((spawn, spawnId) => {
    if (allBlocked) {
      const forced = searchPath(spawn, REPRESENTATIVE_TYPE, occupancy, influence, true, preferred);
      if (forced.path.length > 0) forcedPaths.set(spawnId, forced.path);
    }

    enemyTypes.forEach((enemyType) => {
      const key = routeKey(spawnId, enemyType);
      const normal = searchPath(spawn, enemyType, occupancy, influence, false);
      const forced = searchPath(spawn, enemyType, occupancy, influence, true, preferred);
      unitNormalPaths.set(key, normal.path);
      unitForcedPaths.set(key, forced.path);
      unitNormalCosts.set(key, normal.cost);
      unitForcedCosts.set(key, forced.cost);
    });
  });

  const resolvedBreachPath = allBlocked
    ? pickBestDisplayPath(
        [...forcedPaths.values()].map((path) => ({
          path,
          cost: path.length,
        })),
      )
    : breachPath;

  return {
    phase: allBlocked ? "forced" : "normal",
    normalPaths,
    forcedPaths,
    unitNormalPaths,
    unitForcedPaths,
    unitNormalCosts,
    unitForcedCosts,
    breachPath: resolvedBreachPath,
    keyBlockers: blockedCellsInPath(resolvedBreachPath, occupancy),
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
