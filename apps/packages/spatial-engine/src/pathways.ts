import type { Room } from "@reality-builder/shared";
import { pointPolygonDistance, roomToWorld, worldToRoom, type Point, type Polygon } from "./geometry.js";

/** Walkability grid over a room's interior, in room-local coordinates. */
export type WalkGrid = {
  room: Room;
  cellSize: number;
  columns: number;
  rows: number;
  /** 1 = blocked for a walker of the configured radius. */
  blocked: Uint8Array;
};

const MAX_CELLS = 40_000;

export function cellCenterLocal(grid: WalkGrid, column: number, row: number): Point {
  return [
    -grid.room.dimensions.width / 2 + (column + 0.5) * grid.cellSize,
    -grid.room.dimensions.depth / 2 + (row + 0.5) * grid.cellSize,
  ];
}

export function localToCell(grid: WalkGrid, [x, z]: Point): [number, number] {
  return [
    Math.floor((x + grid.room.dimensions.width / 2) / grid.cellSize),
    Math.floor((z + grid.room.dimensions.depth / 2) / grid.cellSize),
  ];
}

/**
 * Builds the grid. A cell is blocked when a walker of radius `walkerRadius` centered there would touch an
 * obstacle or a wall. Only cells near each obstacle are visited, so cost scales with obstacle area, not count².
 */
export function buildWalkGrid(room: Room, obstacles: Polygon[], walkerRadius: number): WalkGrid {
  const area = room.dimensions.width * room.dimensions.depth;
  const cellSize = Math.max(0.05, Math.sqrt(area / MAX_CELLS), walkerRadius / 3);
  const columns = Math.max(1, Math.floor(room.dimensions.width / cellSize));
  const rows = Math.max(1, Math.floor(room.dimensions.depth / cellSize));
  const grid: WalkGrid = { room, cellSize, columns, rows, blocked: new Uint8Array(columns * rows) };

  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const [x, z] = cellCenterLocal(grid, column, row);
      if (halfW - Math.abs(x) < walkerRadius || halfD - Math.abs(z) < walkerRadius) grid.blocked[row * columns + column] = 1;
    }
  }

  for (const obstacle of obstacles) {
    const local = obstacle.map((point) => worldToRoom(room, point));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of local) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const [c0, r0] = localToCell(grid, [minX - walkerRadius, minZ - walkerRadius]);
    const [c1, r1] = localToCell(grid, [maxX + walkerRadius, maxZ + walkerRadius]);
    for (let row = Math.max(0, r0); row <= Math.min(rows - 1, r1); row += 1) {
      for (let column = Math.max(0, c0); column <= Math.min(columns - 1, c1); column += 1) {
        const index = row * columns + column;
        if (grid.blocked[index]) continue;
        if (pointPolygonDistance(cellCenterLocal(grid, column, row), local) < walkerRadius) grid.blocked[index] = 1;
      }
    }
  }
  return grid;
}

/** 4-connected flood fill from the start cells; returns a reachability mask. */
export function floodFill(grid: WalkGrid, starts: number[]): Uint8Array {
  const reached = new Uint8Array(grid.blocked.length);
  const queue = new Int32Array(grid.blocked.length);
  let head = 0;
  let tail = 0;
  for (const start of starts) {
    if (!grid.blocked[start] && !reached[start]) {
      reached[start] = 1;
      queue[tail++] = start;
    }
  }
  while (head < tail) {
    const index = queue[head++]!;
    const column = index % grid.columns;
    const row = (index - column) / grid.columns;
    const neighbors = [
      column > 0 ? index - 1 : -1,
      column < grid.columns - 1 ? index + 1 : -1,
      row > 0 ? index - grid.columns : -1,
      row < grid.rows - 1 ? index + grid.columns : -1,
    ];
    for (const next of neighbors) {
      if (next < 0 || reached[next] || grid.blocked[next]) continue;
      reached[next] = 1;
      queue[tail++] = next;
    }
  }
  return reached;
}

/** A* (8-connected, octile heuristic, no corner cutting) from start cell to the nearest goal cell. */
export function findPath(grid: WalkGrid, start: number, goals: Set<number>): number[] | null {
  if (grid.blocked[start] || goals.size === 0) return null;
  const goalPoints = [...goals].map((index) => [index % grid.columns, Math.floor(index / grid.columns)] as const);
  const heuristic = (index: number) => {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    let best = Infinity;
    for (const [gc, gr] of goalPoints) {
      const dx = Math.abs(gc - column);
      const dz = Math.abs(gr - row);
      best = Math.min(best, Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz));
    }
    return best;
  };
  const cost = new Float64Array(grid.blocked.length).fill(Infinity);
  const parent = new Int32Array(grid.blocked.length).fill(-1);
  const closed = new Uint8Array(grid.blocked.length);
  const open = new MinHeap();
  cost[start] = 0;
  open.push(start, heuristic(start));
  while (open.size > 0) {
    const index = open.pop();
    if (closed[index]) continue;
    closed[index] = 1;
    if (goals.has(index)) {
      const path = [index];
      let current = index;
      while (parent[current]! >= 0) {
        current = parent[current]!;
        path.push(current);
      }
      return path.reverse();
    }
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dz) continue;
        const nc = column + dx;
        const nr = row + dz;
        if (nc < 0 || nr < 0 || nc >= grid.columns || nr >= grid.rows) continue;
        const next = nr * grid.columns + nc;
        if (grid.blocked[next] || closed[next]) continue;
        if (dx && dz && (grid.blocked[row * grid.columns + nc] || grid.blocked[nr * grid.columns + column])) continue;
        const nextCost = cost[index]! + (dx && dz ? Math.SQRT2 : 1);
        if (nextCost < cost[next]!) {
          cost[next] = nextCost;
          parent[next] = index;
          open.push(next, nextCost + heuristic(next));
        }
      }
    }
  }
  return null;
}

export function cellToWorld(grid: WalkGrid, index: number): Point {
  const column = index % grid.columns;
  const row = Math.floor(index / grid.columns);
  return roomToWorld(grid.room, cellCenterLocal(grid, column, row));
}

class MinHeap {
  private items: number[] = [];
  private priorities: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, priority: number) {
    this.items.push(item);
    this.priorities.push(priority);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priorities[parent]! <= priority) break;
      this.swap(index, parent);
      index = parent;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.priorities[left]! < this.priorities[smallest]!) smallest = left;
        if (right < this.items.length && this.priorities[right]! < this.priorities[smallest]!) smallest = right;
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b]!, this.priorities[a]!];
  }
}
