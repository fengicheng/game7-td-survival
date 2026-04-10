export type Phase = "prep" | "battle" | "shop" | "defeat";

export type TowerType = "gun" | "sniper" | "cannon" | "slow" | "support" | "fortress";

export type EnemyType = "light" | "heavy" | "engineer" | "beast" | "destroyer" | "boss";

export type ItemType =
  | "roadblock"
  | "wire"
  | "mine"
  | "barrel"
  | "decoy"
  | "repairStation"
  | "energyNode"
  | "fireBeacon"
  | "reinforcedWall";

export interface Point {
  x: number;
  y: number;
}

export interface TowerStats {
  cost: number;
  maxHp: number;
  armor: number;
  damage: number;
  cooldown: number;
  range: number;
  splash?: number;
  slowPct?: number;
  slowDuration?: number;
  auraRange?: number;
  auraAttackBonus?: number;
  auraSpeedBonus?: number;
  auraRepairDiscount?: number;
  repairFactor: number;
}

export interface TowerConfig {
  name: string;
  short: string;
  color: string;
  description: string;
  levels: [TowerStats, TowerStats, TowerStats];
}

export interface EnemyPathWeights {
  length: number;
  fire: number;
  control: number;
  danger: number;
  structure: number;
  wall: number;
}

export interface EnemyConfig {
  name: string;
  color: string;
  hp: number;
  armor: number;
  speed: number;
  towerDamage: number;
  attackCooldown: number;
  attackRange: number;
  coreDamage: number;
  gold: number;
  boss?: boolean;
  activeSaboteur?: boolean;
  rangedBreaker?: boolean;
  frenzy?: boolean;
  pathWeights: EnemyPathWeights;
}

export interface ItemConfig {
  name: string;
  color: string;
  price: number;
  description: string;
  blocking: boolean;
  usableDuring: "prep" | "battle" | "any";
  duration?: number;
  maxHp?: number;
  armor?: number;
  slowPct?: number;
  damage?: number;
  auraAttackBonus?: number;
  auraSpeedBonus?: number;
  auraRepairDiscount?: number;
}

export interface TowerEntity {
  id: number;
  type: TowerType;
  level: 1 | 2 | 3;
  x: number;
  y: number;
  hp: number;
  cooldownLeft: number;
  targetId?: number;
}

export interface ItemEntity {
  id: number;
  type: ItemType;
  x: number;
  y: number;
  hp?: number;
  expiresAt?: number;
  triggered?: boolean;
}

export interface FragileWallEntity {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  armor: number;
}

export interface EnemyEntity {
  id: number;
  type: EnemyType;
  spawnId: number;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  cellX: number;
  cellY: number;
  progress: number;
  speedMultiplier: number;
  slowUntil: number;
  cooldownLeft: number;
  route: Point[];
  routeIndex: number;
  routeSignature: string;
  targetTowerId?: number;
}

export interface InventoryEntry {
  type: ItemType;
  quantity: number;
}

export interface ShopOffer {
  id: number;
  type: ItemType | "credit" | "repairDiscount" | "towerBoost" | "fortify";
  name: string;
  description: string;
  price: number;
}

export interface WaveSpawn {
  time: number;
  spawnId: number;
  type: EnemyType;
}

export interface PathBundle {
  phase: "normal" | "forced";
  normalPaths: Map<number, Point[]>;
  forcedPaths: Map<number, Point[]>;
  unitNormalPaths: Map<string, Point[]>;
  unitForcedPaths: Map<string, Point[]>;
  unitNormalCosts: Map<string, number>;
  unitForcedCosts: Map<string, number>;
  breachPath: Point[];
  keyBlockers: Set<string>;
}
