import type {
  GameElement,
  HedgeHogMode,
  UpdateTicker,
} from "@posthog/hedgehog-mode";
import Matter from "matter-js";
import { Graphics } from "pixi.js";

const PROJECTILE_CATEGORY = 0x0004;
const MAX_PILES = 3;
const SPAWN_INTERVAL_MS = 15_000;
const BLOCK_SIZE = 32;
const REST_LIFETIME_MS = 8_000;
const REST_SPEED_THRESHOLD = 0.05;
const PILE_HEIGHT_MIN = 3;
const PILE_HEIGHT_MAX = 5;
const PALETTE = [0xf8c537, 0xe36588, 0x5bc0eb, 0x9bc53d, 0xfde74c, 0xc792ea];

class PileBlock implements GameElement {
  readonly rigidBody: Matter.Body;
  readonly isInteractive = false;
  readonly pileId: number;
  private readonly graphics: Graphics;
  private readonly game: HedgeHogMode;
  private restMs = 0;
  private dead = false;

  constructor(
    game: HedgeHogMode,
    pileId: number,
    x: number,
    y: number,
    color: number,
  ) {
    this.game = game;
    this.pileId = pileId;

    this.rigidBody = Matter.Bodies.rectangle(x, y, BLOCK_SIZE, BLOCK_SIZE, {
      density: 0.0015,
      friction: 0.5,
      frictionAir: 0.01,
      restitution: 0.15,
      label: "PileBlock",
      collisionFilter: {
        category: PROJECTILE_CATEGORY,
        mask: 0xffff,
      },
    });
    Matter.Composite.add(game.engine.world, this.rigidBody);

    this.graphics = new Graphics()
      .rect(-BLOCK_SIZE / 2, -BLOCK_SIZE / 2, BLOCK_SIZE, BLOCK_SIZE)
      .fill(color)
      .stroke({ width: 1, color: 0x000000, alpha: 0.3 });
    this.graphics.position.set(x, y);
    game.app.stage.addChild(this.graphics);
  }

  update({ deltaMS }: UpdateTicker): void {
    if (this.dead) return;
    const body = this.rigidBody;
    this.graphics.position.set(body.position.x, body.position.y);
    this.graphics.rotation = body.angle;

    if (
      body.position.y > window.innerHeight + 400 ||
      body.position.x < -400 ||
      body.position.x > window.innerWidth + 400
    ) {
      this.dead = true;
      return;
    }

    if (body.speed < REST_SPEED_THRESHOLD) {
      this.restMs += deltaMS;
      if (this.restMs > REST_LIFETIME_MS) {
        this.dead = true;
      }
    } else {
      this.restMs = 0;
    }
  }

  beforeUnload(): void {
    this.game.app.stage.removeChild(this.graphics);
    this.graphics.destroy();
  }

  get isDead(): boolean {
    return this.dead;
  }
}

export class PileSpawner {
  private readonly game: HedgeHogMode;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly blocks = new Set<PileBlock>();
  private nextPileId = 1;
  private destroyed = false;

  constructor(game: HedgeHogMode) {
    this.game = game;
    this.spawnPile();
    this.timer = setInterval(() => this.tick(), SPAWN_INTERVAL_MS);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.timer);
    for (const block of this.blocks) {
      this.game.removeElement(block);
    }
    this.blocks.clear();
  }

  private tick(): void {
    if (this.destroyed) return;

    for (const block of [...this.blocks]) {
      if (block.isDead) {
        this.game.removeElement(block);
        this.blocks.delete(block);
      }
    }

    const livePileIds = new Set<number>();
    for (const block of this.blocks) {
      livePileIds.add(block.pileId);
    }

    if (livePileIds.size < MAX_PILES) {
      this.spawnPile();
    }
  }

  private spawnPile(): void {
    if (this.destroyed) return;

    const margin = 80;
    const xRange = Math.max(window.innerWidth - margin * 2, 200);
    const x = margin + Math.random() * xRange;
    const groundTopY = window.innerHeight;
    const height =
      PILE_HEIGHT_MIN +
      Math.floor(Math.random() * (PILE_HEIGHT_MAX - PILE_HEIGHT_MIN + 1));
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const pileId = this.nextPileId++;

    for (let i = 0; i < height; i++) {
      const block = new PileBlock(
        this.game,
        pileId,
        x + (Math.random() - 0.5) * 4,
        groundTopY - BLOCK_SIZE / 2 - i * BLOCK_SIZE,
        color,
      );
      this.game.elements.push(block);
      this.blocks.add(block);
    }
  }
}
