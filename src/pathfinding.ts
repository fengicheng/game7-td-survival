import { CORE, DANGER_PATH_PENALTY, GRID_HEIGHT, GRID_WIDTH, SPAWNS } from "./data";
import type { FragileWallEntity, ItemEntity, PathBundle, Point, TowerEntity } from "./types";

interface Occupancy {
  towers: Map<string, TowerEntity>;
  items: Map<string, ItemEntity>;
  fragileWalls: Map<string, FragileWallEntity>;
  walls: Set<string>;
  danger: Set<string>;
}

interface WeightedNode extends Point {
  removed: number;
  steps: number;
  danger: number;
  turns: number;
  dir: string;
}

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

function isBlockingItem(key: string, occupancy: Occupancy) {
  const item = occupancy.items.get(key);
  return item?.type === "roadblock" || item?.type === "reinforcedWall";
}

function isBlocked(x: number, y: number, occupancy: Occupancy) {
  const key = toKey(x, y);
  return occupancy.walls.has(key) || occupancy.fragileWalls.has(key) || occupancy.towers.has(key) || isBlockingItem(key, occupancy);
}

function reconstruct(end: Point, parents: Map<string, string>) {
  const path: Point[] = [];
  let key = toKey(end.x, end.y);
  while (key) {
    const [x, y] = key.split(",").map(Number);
    path.unshift({ x, y });
    key = parents.get(key) ?? "";
  }
  return path;
}

function normalPath(start: Point, occupancy: Occupancy) {
  const frontier: WeightedNode[] = [{ ...start, removed: 0, steps: 0, danger: 0, turns: 0, dir: "S" }];
  const best = new Map<string, WeightedNode>();
  const parents = new Map<string, string>();
  best.set(toKey(start.x, start.y), frontier[0]);

  while (frontier.length) {
    frontier.sort(compareNormal);
    const current = frontier.shift()!;
    if (current.x === CORE.x && current.y === CORE.y) return reconstruct(current, parents);

    for (const dir of DIRS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (!isInside(nx, ny) || isBlocked(nx, ny, occupancy)) continue;
      const key = toKey(nx, ny);
      const next: WeightedNode = {
        x: nx,
        y: ny,
        removed: 0,
        steps: current.steps + 1,
        danger: current.danger + (occupancy.danger.has(key) ? DANGER_PATH_PENALTY : 0),
        turns: current.turns + (current.dir !== "S" && current.dir !== dir.key ? 1 : 0),
        dir: dir.key,
      };
      const prev = best.get(key);
      if (!prev || compareNormal(next, prev) < 0) {
        best.set(key, next);
        parents.set(key, toKey(current.x, current.y));
        frontier.push(next);
      }
    }
  }

  return [] as Point[];
}

function compareNormal(a: WeightedNode, b: WeightedNode) {
  if (a.steps !== b.steps) return a.steps - b.steps;
  if (a.danger !== b.danger) return a.danger - b.danger;
  if (a.turns !== b.turns) return a.turns - b.turns;
  return a.y - b.y || a.x - b.x;
}

function compareWeighted(a: WeightedNode, b: WeightedNode) {
  if (a.removed !== b.removed) return a.removed - b.removed;
  if (a.steps !== b.steps) return a.steps - b.steps;
  if (a.danger !== b.danger) return a.danger - b.danger;
  if (a.turns !== b.turns) return a.turns - b.turns;
  return a.y - b.y || a.x - b.x;
}

function weightedPath(start: Point, occupancy: Occupancy, preferred?: Set<string>) {
  const frontier: WeightedNode[] = [{ ...start, removed: 0, steps: 0, danger: 0, turns: 0, dir: "S" }];
  const best = new Map<string, WeightedNode>();
  const parents = new Map<string, string>();
  best.set(toKey(start.x, start.y), frontier[0]);

  while (frontier.length) {
    frontier.sort(compareWeighted);
    const current = frontier.shift()!;
    if (current.x === CORE.x && current.y === CORE.y) return reconstruct(current, parents);

    for (const dir of DIRS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (!isInside(nx, ny)) continue;
      const key = toKey(nx, ny);
      const blocked = isBlocked(nx, ny, occupancy) ? 1 : 0;
      const preferredPenalty = preferred && preferred.size > 0 && !preferred.has(key) ? 0.001 : 0;
      const next: WeightedNode = {
        x: nx,
        y: ny,
        removed: current.removed + blocked,
        steps: current.steps + 1 + preferredPenalty,
        danger: current.danger + (occupancy.danger.has(key) ? DANGER_PATH_PENALTY : 0),
        turns: current.turns + (current.dir !== "S" && current.dir !== dir.key ? 1 : 0),
        dir: dir.key,
      };
      const prev = best.get(key);
      if (!prev || compareWeighted(next, prev) < 0) {
        best.set(key, next);
        parents.set(key, toKey(current.x, current.y));
        frontier.push(next);
      }
    }
  }

  return [] as Point[];
}

function countTurns(path: Point[]) {
  let turns = 0;
  let lastDir = "";
  for (let i = 1; i < path.length; i += 1) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const dir = `${dx},${dy}`;
    if (lastDir && lastDir !== dir) turns += 1;
    lastDir = dir;
  }
  return turns;
}

function blockedCellsInPath(path: Point[], occupancy: Occupancy) {
  const blockers = new Set<string>();
  path.forEach((point) => {
    const key = toKey(point.x, point.y);
    if (occupancy.towers.has(key) || occupancy.fragileWalls.has(key) || isBlockingItem(key, occupancy)) blockers.add(key);
  });
  return blockers;
}

export function computePathBundle(
  towers: TowerEntity[],
  items: ItemEntity[],
  fragileWalls: FragileWallEntity[],
  walls: Set<string>,
  danger: Set<string>,
): PathBundle {
  const occupancy: Occupancy = {
    towers: new Map(towers.map((tower) => [toKey(tower.x, tower.y), tower])),
    items: new Map(items.map((item) => [toKey(item.x, item.y), item])),
    fragileWalls: new Map(fragileWalls.map((wall) => [toKey(wall.x, wall.y), wall])),
    walls,
    danger,
  };

  const normalPaths = new Map<number, Point[]>();
  let allBlocked = true;

  SPAWNS.forEach((spawn, spawnId) => {
    const path = normalPath(spawn, occupancy);
    if (path.length) {
      normalPaths.set(spawnId, path);
      allBlocked = false;
    }
  });

  if (!allBlocked) {
    const forcedPaths = new Map<number, Point[]>();
    SPAWNS.forEach((spawn, spawnId) => {
      forcedPaths.set(spawnId, normalPaths.get(spawnId) ?? weightedPath(spawn, occupancy));
    });
    return { phase: "normal", normalPaths, forcedPaths, breachPath: [], keyBlockers: new Set() };
  }

  const breachCandidates = SPAWNS.map((spawn, spawnId) => ({ spawnId, path: weightedPath(spawn, occupancy) })).filter(
    (entry) => entry.path.length > 0,
  );

  breachCandidates.sort((a, b) => {
    const aBlocked = blockedCellsInPath(a.path, occupancy).size;
    const bBlocked = blockedCellsInPath(b.path, occupancy).size;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return countTurns(a.path) - countTurns(b.path);
  });

  const breachPath = breachCandidates[0]?.path ?? [];
  const preferred = new Set(breachPath.map((point) => toKey(point.x, point.y)));
  const forcedPaths = new Map<number, Point[]>();
  SPAWNS.forEach((spawn, spawnId) => {
    forcedPaths.set(spawnId, weightedPath(spawn, occupancy, preferred));
  });

  return {
    phase: "forced",
    normalPaths,
    forcedPaths,
    breachPath,
    keyBlockers: blockedCellsInPath(breachPath, occupancy),
  };
}
