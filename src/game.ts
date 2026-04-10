import {
  CORE,
  DANGER_DAMAGE_PER_SECOND,
  DANGER_TILES,
  ENEMIES,
  INITIAL_CORE_HP,
  INITIAL_GOLD,
  ITEMS,
  OVERLOAD_LIMIT,
  OVERLOAD_SECONDS,
  SPAWNS,
  BUILDABLE_TILES,
  FRAGILE_WALL_TILES,
  TERRAIN_WALLS,
  TOWERS,
  createFragileWalls,
  generateWave,
  getEnemyMultiplier,
  getTowerStats,
  rollShopOffers,
} from "./data";
import { computePathBundle, toKey } from "./pathfinding";
import type {
  EnemyEntity,
  EnemyType,
  FragileWallEntity,
  InventoryEntry,
  ItemEntity,
  ItemType,
  PathBundle,
  Phase,
  Point,
  ShopOffer,
  TowerEntity,
  TowerStats,
  TowerType,
} from "./types";

interface TemporaryBuffs {
  attackBoostWaves: number;
  fortifyWaves: number;
  repairDiscountWaves: number;
}

interface BreakthroughPlan {
  mode: "default" | "force" | "wall";
  wallId?: number;
  forceCost: number;
  wallCost?: number;
  summary: string;
}

export class GameState {
  phase: Phase = "prep";
  wave = 1;
  gold = INITIAL_GOLD;
  coreHp = INITIAL_CORE_HP;
  elapsed = 0;
  message = "放置防御塔，利用堵路重塑敌人路线。";
  selectedTower: TowerType | null = "gun";
  selectedItem: ItemType | null = null;
  towers: TowerEntity[] = [];
  items: ItemEntity[] = [];
  fragileWalls: FragileWallEntity[] = [];
  enemies: EnemyEntity[] = [];
  inventory: InventoryEntry[] = [];
  shopOffers: ShopOffer[] = [];
  battleTime = 0;
  spawnCursor = 0;
  wavePlan = generateWave(1);
  nextEntityId = 1;
  overloadCounter = 0;
  lastWaveForced = false;
  waveLeaked = false;
  breakthroughPlan: BreakthroughPlan = {
    mode: "default",
    forceCost: 0,
    summary: "正常推进",
  };
  stats = {
    kills: 0,
    forcedCount: 0,
    buildSpend: 0,
    repairSpend: 0,
    longestPerfect: 0,
    currentPerfect: 0,
  };
  buffs: TemporaryBuffs = {
    attackBoostWaves: 0,
    fortifyWaves: 0,
    repairDiscountWaves: 0,
  };
  buildable = new Set<string>();
  pathBundle: PathBundle;

  constructor() {
    BUILDABLE_TILES.forEach((key) => this.buildable.add(key));
    this.fragileWalls = createFragileWalls(this.nextEntityId);
    const maxId = this.fragileWalls.reduce((value, wall) => Math.max(value, wall.id), this.nextEntityId);
    this.nextEntityId = maxId;
    this.pathBundle = computePathBundle(this.towers, this.items, this.fragileWalls, TERRAIN_WALLS, DANGER_TILES);
    this.evaluateBreakthroughPlan();
    this.refreshShop();
  }

  update(dt: number) {
    this.elapsed += dt;
    if (this.phase !== "battle") return;
    this.battleTime += dt;
    this.spawnEnemies();
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.updateItems();
    this.cleanup();
    this.recomputePaths();
    this.checkBattleEnd();
    this.checkDefeat(dt);
  }

  placeTower(type: TowerType, x: number, y: number) {
    if (this.phase !== "prep") return false;
    if (!this.canPlaceAt(x, y)) return false;
    const stats = getTowerStats(type, 1);
    if (this.gold < stats.cost) return false;
    this.gold -= stats.cost;
    this.stats.buildSpend += stats.cost;
    this.towers.push({
      id: this.nextEntityId += 1,
      type,
      level: 1,
      x,
      y,
      hp: this.applyFortify(stats.maxHp),
      cooldownLeft: 0,
    });
    this.message = `${TOWERS[type].name} 已部署。`;
    this.recomputePaths();
    return true;
  }

  placeInventoryItem(type: ItemType, x: number, y: number) {
    const config = ITEMS[type];
    if (!this.canPlaceAt(x, y)) return false;
    if (this.phase === "battle" && config.usableDuring === "prep") return false;
    if (this.phase !== "battle" && config.usableDuring === "battle") return false;
    const slot = this.inventory.find((entry) => entry.type === type && entry.quantity > 0);
    if (!slot) return false;
    slot.quantity -= 1;
    if (slot.quantity <= 0) this.inventory = this.inventory.filter((entry) => entry.quantity > 0);
    this.items.push({
      id: this.nextEntityId += 1,
      type,
      x,
      y,
      hp: config.maxHp,
      expiresAt: config.duration ? this.elapsed + config.duration : undefined,
    });
    this.message = `${config.name} 已放置。`;
    if (config.blocking) this.recomputePaths();
    return true;
  }

  upgradeTower(id: number) {
    if (this.phase !== "prep") return false;
    const tower = this.towers.find((entry) => entry.id === id);
    if (!tower || tower.level >= 3) return false;
    const nextLevel = (tower.level + 1) as 2 | 3;
    const stats = getTowerStats(tower.type, nextLevel);
    if (this.gold < stats.cost) return false;
    this.gold -= stats.cost;
    this.stats.buildSpend += stats.cost;
    tower.level = nextLevel;
    tower.hp = Math.min(this.applyFortify(stats.maxHp), tower.hp + Math.round(stats.maxHp * 0.35));
    this.message = `${TOWERS[tower.type].name} 升至 ${nextLevel} 级。`;
    this.recomputePaths();
    return true;
  }

  downgradeTower(id: number) {
    if (this.phase !== "prep") return false;
    const tower = this.towers.find((entry) => entry.id === id);
    if (!tower || tower.level <= 1) return false;
    const refund = this.downgradeRefund(tower);
    const previousLevel = tower.level;
    const nextLevel = (tower.level - 1) as 1 | 2;
    tower.level = nextLevel;
    tower.hp = Math.min(this.maxTowerHp(tower), tower.hp);
    this.gold += refund;
    this.message = `${TOWERS[tower.type].name} 从 Lv${previousLevel} 降至 Lv${nextLevel}，返还 ${refund} 金币。`;
    this.recomputePaths();
    return true;
  }

  sellTower(id: number) {
    if (this.phase !== "prep") return false;
    const index = this.towers.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    const tower = this.towers[index];
    const refund = this.sellValue(tower);
    this.gold += refund;
    this.towers.splice(index, 1);
    this.message = `已拆除 ${TOWERS[tower.type].name}，返还 ${refund} 金币。`;
    this.recomputePaths();
    return true;
  }

  repairAll() {
    if (this.phase !== "prep") return false;
    let total = 0;
    this.towers.forEach((tower) => {
      total += this.repairCost(tower);
    });
    this.items.forEach((item) => {
      total += this.repairItemCost(item);
    });
    if (total <= 0 || this.gold < total) return false;
    this.gold -= total;
    this.stats.repairSpend += total;
    this.towers.forEach((tower) => {
      tower.hp = this.maxTowerHp(tower);
    });
    this.items.forEach((item) => {
      const config = ITEMS[item.type];
      if (config.maxHp) item.hp = config.maxHp;
    });
    this.message = `批量维修完成，花费 ${total} 金币。`;
    return true;
  }

  startWave() {
    if (this.phase !== "prep") return false;
    this.phase = "battle";
    this.wavePlan = generateWave(this.wave);
    this.spawnCursor = 0;
    this.battleTime = 0;
    this.waveLeaked = false;
    if (this.buffs.fortifyWaves > 0) {
      this.towers.forEach((tower) => {
        tower.hp = Math.min(this.maxTowerHp(tower), Math.round(tower.hp * 1.15));
      });
    }
    this.lastWaveForced = this.pathBundle.phase === "forced";
    if (this.lastWaveForced) this.stats.forcedCount += 1;
    this.evaluateBreakthroughPlan();
    this.message = this.lastWaveForced ? "战斗开始，敌人获得突破强化。" : "战斗开始。";
    return true;
  }

  buyOffer(id: number) {
    if (this.phase !== "shop") return false;
    const offer = this.shopOffers.find((entry) => entry.id === id);
    if (!offer || this.gold < offer.price) return false;
    this.gold -= offer.price;
    if (offer.type === "credit") {
      this.gold += 60;
    } else if (offer.type === "repairDiscount") {
      this.buffs.repairDiscountWaves = Math.max(1, this.buffs.repairDiscountWaves);
    } else if (offer.type === "towerBoost") {
      this.buffs.attackBoostWaves = Math.max(1, this.buffs.attackBoostWaves);
    } else if (offer.type === "fortify") {
      this.buffs.fortifyWaves = Math.max(1, this.buffs.fortifyWaves);
    } else {
      const slot = this.inventory.find((entry) => entry.type === offer.type);
      if (slot) slot.quantity += 1;
      else this.inventory.push({ type: offer.type, quantity: 1 });
    }
    this.shopOffers = this.shopOffers.filter((entry) => entry.id !== id);
    this.message = `已购买 ${offer.name}。`;
    return true;
  }

  rerollShop() {
    if (this.phase !== "shop") return false;
    const price = 12;
    if (this.gold < price) return false;
    this.gold -= price;
    this.refreshShop();
    this.message = `刷新商店，花费 ${price} 金币。`;
    return true;
  }

  closeShop() {
    if (this.phase !== "shop") return false;
    this.applyWaveEndEffects();
    this.phase = "prep";
    this.wave += 1;
    this.message = "进入准备阶段，可继续布防。";
    return true;
  }

  cellStatus(x: number, y: number) {
    const key = toKey(x, y);
    return {
      isCore: key === toKey(CORE.x, CORE.y),
      spawnIndex: SPAWNS.findIndex((spawn) => spawn.x === x && spawn.y === y),
      isWall: TERRAIN_WALLS.has(key),
      isDanger: DANGER_TILES.has(key),
      isFragileWallTile: FRAGILE_WALL_TILES.has(key),
      isBuildable: this.buildable.has(key),
      tower: this.towers.find((tower) => tower.x === x && tower.y === y),
      item: this.items.find((item) => item.x === x && item.y === y),
      fragileWall: this.fragileWalls.find((wall) => wall.x === x && wall.y === y),
      isPath:
        [...this.pathBundle.normalPaths.values()].some((path) => path.some((point) => point.x === x && point.y === y)) ||
        [...this.pathBundle.forcedPaths.values()].some((path) => path.some((point) => point.x === x && point.y === y)),
      isBreach: this.pathBundle.breachPath.some((point) => point.x === x && point.y === y),
      isKeyBlocker: this.pathBundle.keyBlockers.has(key),
    };
  }

  maxTowerHp(tower: TowerEntity) {
    return this.applyFortify(getTowerStats(tower.type, tower.level).maxHp);
  }

  repairCost(tower: TowerEntity) {
    const maxHp = this.maxTowerHp(tower);
    if (tower.hp >= maxHp) return 0;
    const ratio = (maxHp - tower.hp) / maxHp;
    const stats = this.getTowerStatsWithAuras(tower);
    let cost = ratio * towerTotalCost(tower.type, tower.level) * 0.5 * stats.repairFactor;
    if (this.lastWaveForced) cost *= 1.25;
    if (this.buffs.repairDiscountWaves > 0) cost *= 0.75;
    return Math.ceil(cost);
  }

  sellValue(tower: TowerEntity) {
    return towerTotalCost(tower.type, tower.level);
  }

  downgradeRefund(tower: TowerEntity) {
    if (tower.level <= 1) return 0;
    return getTowerStats(tower.type, tower.level).cost;
  }

  private canPlaceAt(x: number, y: number) {
    const key = toKey(x, y);
    return (
      this.buildable.has(key) &&
      !this.towers.some((tower) => tower.x === x && tower.y === y) &&
      !this.items.some((item) => item.x === x && item.y === y) &&
      !this.fragileWalls.some((wall) => wall.x === x && wall.y === y)
    );
  }

  private spawnEnemies() {
    while (this.spawnCursor < this.wavePlan.length && this.wavePlan[this.spawnCursor].time <= this.battleTime) {
      const plan = this.wavePlan[this.spawnCursor];
      this.spawnCursor += 1;
      const config = ENEMIES[plan.type];
      const multiplier = getEnemyMultiplier(this.wave);
      const spawn = SPAWNS[plan.spawnId];
      this.enemies.push({
        id: this.nextEntityId += 1,
        type: plan.type,
        spawnId: plan.spawnId,
        hp: Math.round(config.hp * multiplier.hp),
        x: spawn.x,
        y: spawn.y,
        cellX: spawn.x,
        cellY: spawn.y,
        progress: 0,
        speedMultiplier: this.lastWaveForced ? 1.1 : 1,
        slowUntil: 0,
        cooldownLeft: 0,
        route: this.currentPathForSpawn(plan.spawnId, plan.type),
        routeIndex: 0,
      });
    }
  }

  private updateEnemies(dt: number) {
    const multiplier = getEnemyMultiplier(this.wave);
    const lure = this.items.find((item) => item.type === "decoy");

    this.enemies.forEach((enemy) => {
      const config = ENEMIES[enemy.type];
      enemy.cooldownLeft = Math.max(0, enemy.cooldownLeft - dt);
      enemy.route = this.currentPathForSpawn(enemy.spawnId, enemy.type);

      const wallTarget = this.activeBreakWallTarget(enemy);
      if (wallTarget) {
        this.attackStructure(enemy, wallTarget, multiplier.towerDamage, dt);
        return;
      }

      const forcedTarget = this.pickSaboteurTarget(enemy, lure);
      if (forcedTarget) {
        this.attackStructure(enemy, forcedTarget, multiplier.towerDamage, dt);
        return;
      }

      const next = enemy.route[enemy.routeIndex + 1];
      if (!next) {
        this.coreHp -= config.coreDamage;
        enemy.hp = -9999;
        this.waveLeaked = true;
        return;
      }

      const blocker = this.findBlockingAt(next.x, next.y);
      if (blocker) {
        this.attackStructure(enemy, blocker, multiplier.towerDamage, dt);
        return;
      }

      const speed = config.speed * multiplier.speed * enemy.speedMultiplier * (enemy.slowUntil > this.elapsed ? 0.65 : 1);
      enemy.progress += speed * dt;
      while (enemy.progress >= 1) {
        enemy.progress -= 1;
        enemy.routeIndex += 1;
        const current = enemy.route[enemy.routeIndex];
        if (!current) break;
        enemy.cellX = current.x;
        enemy.cellY = current.y;
      }
      const current = enemy.route[enemy.routeIndex] ?? { x: enemy.cellX, y: enemy.cellY };
      const upcoming = enemy.route[enemy.routeIndex + 1] ?? current;
      enemy.x = current.x + (upcoming.x - current.x) * enemy.progress;
      enemy.y = current.y + (upcoming.y - current.y) * enemy.progress;

      const wire = this.items.find((item) => item.type === "wire" && item.x === current.x && item.y === current.y);
      if (wire) enemy.slowUntil = Math.max(enemy.slowUntil, this.elapsed + 0.6);
      if (DANGER_TILES.has(toKey(current.x, current.y))) {
        enemy.hp -= DANGER_DAMAGE_PER_SECOND * dt;
      }

      const mine = this.items.find((item) => item.type === "mine" && item.x === current.x && item.y === current.y && !item.triggered);
      if (mine) {
        mine.triggered = true;
        this.damageEnemiesInRadius(current.x, current.y, 1.2, ITEMS.mine.damage ?? 0);
      }

      const barrel = this.items.find((item) => item.type === "barrel" && item.x === current.x && item.y === current.y && !item.triggered);
      if (barrel) {
        barrel.triggered = true;
        this.damageEnemiesInRadius(current.x, current.y, 1.4, ITEMS.barrel.damage ?? 0);
        barrel.hp = 0;
      }
    });
  }

  private updateTowers(dt: number) {
    this.towers.forEach((tower) => {
      tower.cooldownLeft = Math.max(0, tower.cooldownLeft - dt);
      const stats = this.getTowerStatsWithAuras(tower);
      if (stats.damage <= 0 || tower.cooldownLeft > 0) return;
      const target = this.pickTowerTarget(tower, stats.range);
      if (!target) return;
      const damage = Math.max(1, stats.damage - this.enemyArmor(target));
      if (stats.splash) this.damageEnemiesInRadius(target.x, target.y, stats.splash, damage);
      else target.hp -= damage;
      if (stats.slowPct && stats.slowDuration) {
        target.slowUntil = Math.max(target.slowUntil, this.elapsed + stats.slowDuration);
      }
      tower.cooldownLeft = Math.max(0.12, stats.cooldown);
    });
  }

  private updateItems() {
    this.items.forEach((item) => {
      if (item.expiresAt && item.expiresAt <= this.elapsed) item.hp = 0;
    });
  }

  private cleanup() {
    const multiplier = getEnemyMultiplier(this.wave);
    this.enemies = this.enemies.filter((enemy) => {
      if (enemy.hp > 0) return true;
      if (enemy.hp > -9000) {
        this.gold += Math.round(ENEMIES[enemy.type].gold * multiplier.gold);
        this.stats.kills += 1;
      }
      return false;
    });
    this.towers = this.towers.filter((tower) => tower.hp > 0);
    this.fragileWalls = this.fragileWalls.filter((wall) => wall.hp > 0);
    this.items = this.items.filter((item) => {
      if (item.type === "mine" && item.triggered) return false;
      if (item.expiresAt && item.expiresAt <= this.elapsed) return false;
      if (item.hp !== undefined && item.hp <= 0) return false;
      return true;
    });
  }

  private recomputePaths() {
    const previousPhase = this.pathBundle.phase;
    this.pathBundle = computePathBundle(this.towers, this.items, this.fragileWalls, TERRAIN_WALLS, DANGER_TILES);
    this.evaluateBreakthroughPlan();
    if (this.phase === "battle" && previousPhase !== "forced" && this.pathBundle.phase === "forced" && !this.lastWaveForced) {
      this.lastWaveForced = true;
      this.stats.forcedCount += 1;
      this.message = "战斗中触发强制通路，敌人开始集中突破。";
    }
  }

  private checkBattleEnd() {
    if (this.spawnCursor < this.wavePlan.length || this.enemies.length > 0) return;
    this.gold += 30 + 4 * (this.wave - 1);
    if (this.waveLeaked) {
      this.stats.currentPerfect = 0;
    } else {
      this.stats.currentPerfect += 1;
      this.stats.longestPerfect = Math.max(this.stats.longestPerfect, this.stats.currentPerfect);
    }
    this.expireWaveBuffs();
    this.phase = "shop";
    this.refreshShop();
    this.message = "本波结束，进入商店。";
  }

  private checkDefeat(dt: number) {
    if (this.coreHp <= 0) {
      this.phase = "defeat";
      this.message = "核心被摧毁，防线失守。";
      return;
    }
    if (this.enemies.length > OVERLOAD_LIMIT) {
      this.overloadCounter += dt;
      if (this.overloadCounter >= OVERLOAD_SECONDS) {
        this.phase = "defeat";
        this.message = "场上敌人过多，战场崩溃。";
      }
    } else {
      this.overloadCounter = 0;
    }
  }

  private currentPathForSpawn(spawnId: number, enemyType: EnemyType) {
    const key = this.routeKey(spawnId, enemyType);
    const normalPath = this.pathBundle.unitNormalPaths.get(key) ?? [];
    const forcedPath = this.pathBundle.unitForcedPaths.get(key) ?? [];
    const normalCost = this.pathBundle.unitNormalCosts.get(key) ?? Number.POSITIVE_INFINITY;
    const forcedCost = this.pathBundle.unitForcedCosts.get(key) ?? Number.POSITIVE_INFINITY;

    if (this.pathBundle.phase === "forced") {
      return forcedPath.length ? forcedPath : normalPath;
    }

    if (forcedPath.length && forcedCost + 0.25 < normalCost) {
      return forcedPath;
    }

    return normalPath.length ? normalPath : forcedPath;
  }

  private findBlockingAt(x: number, y: number) {
    return (
      this.fragileWalls.find((wall) => wall.x === x && wall.y === y) ??
      this.towers.find((tower) => tower.x === x && tower.y === y) ??
      this.items.find((item) => item.x === x && item.y === y && ITEMS[item.type].blocking)
    );
  }

  private pickSaboteurTarget(enemy: EnemyEntity, lure?: ItemEntity) {
    const config = ENEMIES[enemy.type];
    if (lure && (config.activeSaboteur || config.rangedBreaker) && distance(enemy, lure) <= 4) return lure;
    if (config.rangedBreaker) {
      const target = [...this.towers, ...this.items.filter((item) => item.hp && item.hp > 0)]
        .filter((entry) => distance(enemy, entry) <= config.attackRange)
        .sort((a, b) => this.targetPriority(a) - this.targetPriority(b))[0];
      if (target) return target;
    }
    if (config.activeSaboteur) {
      const target = this.towers
        .filter((tower) => distance(enemy, tower) <= 2.4)
        .sort((a, b) => this.targetPriority(a) - this.targetPriority(b))[0];
      if (target) return target;
    }
    return undefined;
  }

  private activeBreakWallTarget(enemy: EnemyEntity) {
    if (this.breakthroughPlan.mode !== "wall" || this.breakthroughPlan.wallId === undefined) return undefined;
    const wall = this.fragileWalls.find((entry) => entry.id === this.breakthroughPlan.wallId);
    if (!wall) return undefined;
    const config = ENEMIES[enemy.type];
    if (config.activeSaboteur || config.boss) return wall;
    if (this.pathBundle.phase === "forced") return wall;
    if (distance(enemy, wall) <= 8) return wall;
    return undefined;
  }

  private attackStructure(enemy: EnemyEntity, target: TowerEntity | ItemEntity | FragileWallEntity, towerDamageMultiplier: number, dt: number) {
    const config = ENEMIES[enemy.type];
    if (distance(enemy, target) > config.attackRange + 0.1) {
      const dx = Math.sign(target.x - enemy.x);
      const dy = Math.sign(target.y - enemy.y);
      enemy.x += dx * config.speed * dt * 0.7;
      enemy.y += dy * config.speed * dt * 0.7;
      return;
    }
    if (enemy.cooldownLeft > 0) return;
    const baseDamage = Math.round(config.towerDamage * towerDamageMultiplier * (this.pathBundle.phase === "forced" ? 1.5 : 1));
    const armor = this.structureArmor(target);
    const actual = Math.max(1, baseDamage - armor);
    this.damageStructure(target, actual);
    enemy.cooldownLeft = config.attackCooldown;
    if (config.frenzy && enemy.targetTowerId === target.id) enemy.speedMultiplier = Math.min(enemy.speedMultiplier + 0.12, 1.6);
    else enemy.targetTowerId = target.id;
    if (config.boss && Math.random() < 0.18) this.damageStructuresInRadius(target.x, target.y, 1.1, 120);
  }

  private damageEnemiesInRadius(x: number, y: number, radius: number, damage: number) {
    this.enemies.forEach((enemy) => {
      if (distance({ x, y }, enemy) <= radius) {
        enemy.hp -= Math.max(1, damage - this.enemyArmor(enemy));
      }
    });
  }

  private damageStructuresInRadius(x: number, y: number, radius: number, damage: number) {
    this.towers.forEach((tower) => {
      if (distance({ x, y }, tower) <= radius) tower.hp -= Math.max(1, damage - this.getTowerStatsWithAuras(tower).armor);
    });
    this.fragileWalls.forEach((wall) => {
      if (distance({ x, y }, wall) <= radius) wall.hp -= Math.max(1, damage - wall.armor);
    });
    this.items.forEach((item) => {
      if ((item.hp ?? 0) > 0 && distance({ x, y }, item) <= radius) item.hp = (item.hp ?? 0) - Math.max(1, damage - (ITEMS[item.type].armor ?? 0));
    });
  }

  private enemyArmor(enemy: EnemyEntity) {
    return ENEMIES[enemy.type].armor + getEnemyMultiplier(this.wave).armor;
  }

  private pickTowerTarget(tower: TowerEntity, range: number) {
    return this.enemies
      .filter((enemy) => distance(enemy, tower) <= range)
      .sort((a, b) => b.routeIndex + b.progress - (a.routeIndex + a.progress))[0];
  }

  private getAuraBonuses(x: number, y: number) {
    let attack = 0;
    let speed = 0;
    let repair = 0;
    this.towers.forEach((tower) => {
      const stats = getTowerStats(tower.type, tower.level);
      if (!stats.auraRange || distance({ x, y }, tower) > stats.auraRange) return;
      attack += stats.auraAttackBonus ?? 0;
      speed += stats.auraSpeedBonus ?? 0;
      repair += stats.auraRepairDiscount ?? 0;
    });
    this.items.forEach((item) => {
      if (distance({ x, y }, item) > 2.1) return;
      attack += ITEMS[item.type].auraAttackBonus ?? 0;
      speed += ITEMS[item.type].auraSpeedBonus ?? 0;
      repair += ITEMS[item.type].auraRepairDiscount ?? 0;
    });
    return { attack, speed, repair };
  }

  private getTowerStatsWithAuras(tower: TowerEntity): TowerStats {
    const base = getTowerStats(tower.type, tower.level);
    const aura = this.getAuraBonuses(tower.x, tower.y);
    const attackBoost = 1 + aura.attack + (this.buffs.attackBoostWaves > 0 ? 0.1 : 0);
    return {
      ...base,
      damage: Math.round(base.damage * attackBoost),
      cooldown: base.cooldown / (1 + aura.speed),
      repairFactor: base.repairFactor * (1 - aura.repair),
    };
  }

  private repairItemCost(item: ItemEntity) {
    const config = ITEMS[item.type];
    if (!config.maxHp || item.hp === undefined || item.hp >= config.maxHp) return 0;
    const ratio = (config.maxHp - item.hp) / config.maxHp;
    let cost = ratio * config.price * 0.5;
    if (this.lastWaveForced) cost *= 1.25;
    if (this.buffs.repairDiscountWaves > 0) cost *= 0.75;
    return Math.ceil(cost);
  }

  private targetPriority(target: TowerEntity | ItemEntity) {
    if ("level" in target) {
      if (target.type === "support") return 0;
      if (target.type === "slow") return 1;
      if (target.type === "sniper") return 2;
      if (target.type === "cannon") return 3;
      if (target.type === "gun") return 4;
      return 5;
    }
    return target.type === "decoy" ? -1 : ITEMS[target.type].blocking ? 2 : 3;
  }

  private structureArmor(target: TowerEntity | ItemEntity | FragileWallEntity) {
    if ("level" in target) return this.getTowerStatsWithAuras(target).armor;
    if ("type" in target) return ITEMS[target.type].armor ?? 0;
    return target.armor;
  }

  private damageStructure(target: TowerEntity | ItemEntity | FragileWallEntity, amount: number) {
    if ("level" in target) {
      target.hp -= amount;
      return;
    }
    if ("type" in target) {
      target.hp = (target.hp ?? 0) - amount;
      return;
    }
    target.hp -= amount;
  }

  private refreshShop() {
    this.shopOffers = rollShopOffers(this.wave * 997 + Math.floor(this.elapsed * 10));
  }

  private applyFortify(value: number) {
    return Math.round(value * (this.buffs.fortifyWaves > 0 ? 1.15 : 1));
  }

  private applyWaveEndEffects() {
    this.items.forEach((item) => {
      if (item.type !== "repairStation") return;
      this.towers.forEach((tower) => {
        if (distance(item, tower) <= 1.6) tower.hp = Math.min(this.maxTowerHp(tower), tower.hp + Math.round(this.maxTowerHp(tower) * 0.12));
      });
    });
  }

  private expireWaveBuffs() {
    if (this.buffs.attackBoostWaves > 0) this.buffs.attackBoostWaves -= 1;
    if (this.buffs.fortifyWaves > 0) this.buffs.fortifyWaves -= 1;
    if (this.buffs.repairDiscountWaves > 0) this.buffs.repairDiscountWaves -= 1;
  }

  private evaluateBreakthroughPlan() {
    const activeTypes = this.activeEnemyTypes();
    let normalTotal = 0;
    let forcedTotal = 0;
    let normalCount = 0;
    let forcedCount = 0;

    activeTypes.forEach((enemyType) => {
      SPAWNS.forEach((_, spawnId) => {
        const key = this.routeKey(spawnId, enemyType);
        const normalCost = this.pathBundle.unitNormalCosts.get(key) ?? Number.POSITIVE_INFINITY;
        const forcedCost = this.pathBundle.unitForcedCosts.get(key) ?? Number.POSITIVE_INFINITY;
        if (Number.isFinite(normalCost)) {
          normalTotal += normalCost;
          normalCount += 1;
        }
        if (Number.isFinite(forcedCost)) {
          forcedTotal += forcedCost;
          forcedCount += 1;
        }
      });
    });

    const averageNormal = normalCount ? normalTotal / normalCount : Number.POSITIVE_INFINITY;
    const averageForced = forcedCount ? forcedTotal / forcedCount : Number.POSITIVE_INFINITY;
    const wallTarget = this.primaryBreakWallTarget();

    if (wallTarget && averageForced + 0.5 < averageNormal) {
      this.breakthroughPlan = {
        mode: "wall",
        wallId: wallTarget.id,
        forceCost: averageNormal,
        wallCost: averageForced,
        summary: `最优突破：优先破墙，平均成本 ${formatCost(averageForced)} < ${formatCost(averageNormal)}`,
      };
      return;
    }

    this.breakthroughPlan = {
      mode: this.pathBundle.phase === "forced" ? "force" : "default",
      forceCost: Number.isFinite(averageNormal) ? averageNormal : averageForced,
      wallCost: Number.isFinite(averageForced) ? averageForced : undefined,
      summary:
        this.pathBundle.phase === "forced"
          ? `最优突破：强拆优先，平均成本 ${formatCost(Number.isFinite(averageForced) ? averageForced : averageNormal)}`
          : `最优寻路：正常推进成本 ${formatCost(averageNormal)}，突破成本 ${formatCost(averageForced)}`,
    };
  }

  private activeEnemyTypes() {
    const types = new Set<EnemyType>();
    this.wavePlan.slice(this.spawnCursor).forEach((spawn) => types.add(spawn.type));
    this.enemies.forEach((enemy) => types.add(enemy.type));
    if (!types.size) types.add("light");
    return [...types];
  }

  private primaryBreakWallTarget() {
    for (const point of this.pathBundle.breachPath) {
      const wall = this.fragileWalls.find((entry) => entry.x === point.x && entry.y === point.y);
      if (wall) return wall;
    }
    return undefined;
  }

  private routeKey(spawnId: number, enemyType: EnemyType) {
    return `${spawnId}:${enemyType}`;
  }
}

function towerTotalCost(type: TowerType, level: 1 | 2 | 3) {
  let total = 0;
  for (let current = 1; current <= level; current += 1) total += getTowerStats(type, current as 1 | 2 | 3).cost;
  return total;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatCost(value: number) {
  return Number.isFinite(value) ? value.toFixed(1) : "∞";
}
