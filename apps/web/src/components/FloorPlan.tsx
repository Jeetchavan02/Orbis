import { useMemo, useRef, useState, type ReactNode } from "react";
import type { FurnitureObject, Opening, Room, WallSide } from "@reality-builder/shared";
import { isFloorCovering, rotateYaw, worldToRoom } from "@reality-builder/spatial-engine";
import { catalogById } from "../data/catalog";
import { doorGeometry } from "../lib/doors";
import { useWorkspaceStore } from "../store/workspace";

const INK = "#1b1b1b";
const LINE = 0.018;
const M_TO_FT = 3.28084;

function feetInches(meters: number) {
  const totalInches = Math.round(meters * M_TO_FT * 12);
  return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`;
}

/** Plan symbol for a piece of furniture, drawn in its local frame (x = width, y = depth, +y = front). */
function Symbol({ item }: { item: FurnitureObject }): ReactNode {
  const entry = catalogById(item.catalogItemId);
  const w = item.dimensions.width;
  const d = item.dimensions.depth;
  const x0 = -w / 2;
  const y0 = -d / 2;
  const stroke = { stroke: INK, strokeWidth: LINE, fill: "none" } as const;
  const family = entry?.family ?? "box";
  const outline = <rect x={x0} y={y0} width={w} height={d} fill="#fff" stroke={INK} strokeWidth={LINE * 1.2} rx={family === "sofa" || family === "armchair" ? 0.05 : 0.01} />;
  switch (family) {
    case "bed": {
      const pillows = w > 1.2 ? 2 : 1;
      const pw = (w - 0.2 - (pillows - 1) * 0.06) / pillows;
      return <>{outline}<rect x={x0} y={y0} width={w} height={0.08} fill={INK} />{Array.from({ length: pillows }, (_, i) => <rect key={i} x={x0 + 0.1 + i * (pw + 0.06)} y={y0 + 0.15} width={pw} height={0.32} rx={0.04} {...stroke} />)}<line x1={x0} y1={y0 + d * 0.38} x2={-x0} y2={y0 + d * 0.38} {...stroke} /><path d={`M ${x0} ${y0 + d * 0.38} L ${x0 + w * 0.3} ${y0 + d * 0.52} L ${-x0} ${y0 + d * 0.38}`} {...stroke} strokeWidth={LINE * 0.6} /></>;
    }
    case "sofa": case "armchair": case "sectional": case "recliner": {
      const arm = entry?.params.arm === "none" ? 0 : 0.14;
      const seats = Math.max(1, Number(entry?.params.seats ?? 1));
      return <>{outline}<rect x={x0} y={y0} width={w} height={0.18} {...stroke} />{arm ? <><rect x={x0} y={y0} width={arm} height={d} {...stroke} /><rect x={-x0 - arm} y={y0} width={arm} height={d} {...stroke} /></> : null}{Array.from({ length: seats - 1 }, (_, i) => <line key={i} x1={x0 + arm + ((w - 2 * arm) / seats) * (i + 1)} y1={y0 + 0.18} x2={x0 + arm + ((w - 2 * arm) / seats) * (i + 1)} y2={-y0} {...stroke} strokeWidth={LINE * 0.7} />)}</>;
    }
    case "round-table": case "side-table":
      return <circle r={Math.min(w, d) / 2} fill="#fff" stroke={INK} strokeWidth={LINE * 1.2} />;
    case "chair": case "office-chair": case "stool":
      return <>{outline}<rect x={x0} y={y0} width={w} height={0.07} fill={INK} /></>;
    case "toilet":
      return <><rect x={x0} y={y0} width={w} height={0.18} fill="#fff" stroke={INK} strokeWidth={LINE} /><ellipse cx={0} cy={y0 + 0.18 + (d - 0.18) / 2} rx={w / 2} ry={(d - 0.18) / 2} fill="#fff" stroke={INK} strokeWidth={LINE} /></>;
    case "bathtub":
      return <>{outline}<rect x={x0 + 0.07} y={y0 + 0.07} width={w - 0.14} height={d - 0.14} rx={0.2} {...stroke} /><circle cx={x0 + 0.2} cy={0} r={0.03} {...stroke} /></>;
    case "shower":
      return <>{outline}<line x1={x0} y1={y0} x2={-x0} y2={-y0} {...stroke} strokeWidth={LINE * 0.6} /><line x1={-x0} y1={y0} x2={x0} y2={-y0} {...stroke} strokeWidth={LINE * 0.6} /></>;
    case "vanity": case "sink-cabinet":
      return <>{outline}<ellipse cx={0} cy={0.02} rx={Math.min(0.2, w * 0.3)} ry={Math.min(0.15, d * 0.3)} {...stroke} /></>;
    case "stove":
      return <>{outline}{[[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]].map(([fx, fy], i) => <circle key={i} cx={fx! * w} cy={fy! * d} r={Math.min(w, d) * 0.15} {...stroke} />)}</>;
    case "plant": {
      const r = Math.min(w, d) / 2;
      return <g>{Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <path key={i} d={`M 0 0 Q ${Math.cos(a + 0.3) * r * 0.6} ${Math.sin(a + 0.3) * r * 0.6} ${Math.cos(a) * r} ${Math.sin(a) * r}`} stroke={INK} strokeWidth={LINE * 0.8} fill="none" />; })}<circle r={r * 0.25} fill={INK} /></g>;
    }
    case "rug":
      return entry?.params.shape === "round" ? <circle r={w / 2} fill="none" stroke="#9a9a9a" strokeWidth={LINE} strokeDasharray="0.06 0.04" /> : <rect x={x0} y={y0} width={w} height={d} fill="none" stroke="#9a9a9a" strokeWidth={LINE} strokeDasharray="0.06 0.04" />;
    case "floor-lamp": case "table-lamp": case "desk-lamp": case "pendant": case "ceiling-light":
      return <><circle r={Math.min(w, d) / 2} fill="#fff" stroke={INK} strokeWidth={LINE} /><path d={`M ${x0 * 0.7} 0 L ${-x0 * 0.7} 0 M 0 ${y0 * 0.7} L 0 ${-y0 * 0.7}`} stroke={INK} strokeWidth={LINE * 0.7} /></>;
    case "wardrobe": case "cabinet": case "bookshelf": case "kitchen-counter": case "kitchen-island": case "fridge": case "dresser": case "nightstand": case "tv-unit":
      return <>{outline}<line x1={x0} y1={-y0 - 0.04} x2={-x0} y2={-y0 - 0.04} {...stroke} strokeWidth={LINE * 0.7} />{family === "wardrobe" ? <line x1={x0} y1={y0} x2={-x0} y2={-y0} stroke={INK} strokeWidth={LINE * 0.5} /> : null}</>;
    default:
      return outline;
  }
}

type WallPiece = { kind: "solid" | "window" | "door" | "passage"; from: number; to: number; opening?: Opening };

/** Splits a wall into solid runs and openings along its length (room-local, centred). */
function wallPieces(length: number, openings: Opening[]): WallPiece[] {
  const pieces: WallPiece[] = [];
  let cursor = -length / 2;
  for (const opening of [...openings].sort((a, b) => a.offset - b.offset)) {
    const start = Math.max(-length / 2, opening.offset - opening.width / 2);
    const end = Math.min(length / 2, opening.offset + opening.width / 2);
    if (start > cursor) pieces.push({ kind: "solid", from: cursor, to: start });
    pieces.push({ kind: opening.kind, from: start, to: end, opening });
    cursor = Math.max(cursor, end);
  }
  if (cursor < length / 2) pieces.push({ kind: "solid", from: cursor, to: length / 2 });
  return pieces;
}

function Walls({ room }: { room: Room }) {
  const { width: W, depth: D, wallThickness: t } = room.dimensions;
  const sides: { side: WallSide; length: number; rect: (from: number, to: number) => [number, number, number, number] }[] = [
    { side: "north", length: W, rect: (a, b) => [a, -D / 2 - t, b - a, t] },
    { side: "south", length: W, rect: (a, b) => [a, D / 2, b - a, t] },
    { side: "west", length: D, rect: (a, b) => [-W / 2 - t, a, t, b - a] },
    { side: "east", length: D, rect: (a, b) => [W / 2, a, t, b - a] },
  ];
  const parts: ReactNode[] = [];
  // Corners
  for (const [x, y] of [[-W / 2 - t, -D / 2 - t], [W / 2, -D / 2 - t], [-W / 2 - t, D / 2], [W / 2, D / 2]]) parts.push(<rect key={`c${x}${y}`} x={x} y={y} width={t} height={t} fill={INK} />);
  for (const { side, length, rect } of sides) {
    for (const piece of wallPieces(length, room.openings.filter((opening) => opening.wall === side))) {
      const [x, y, w, h] = rect(piece.from, piece.to);
      if (piece.kind === "solid") parts.push(<rect key={`${side}${piece.from}`} x={x} y={y} width={w} height={h} fill={INK} />);
      if (piece.kind === "window") {
        const horizontal = side === "north" || side === "south";
        parts.push(<rect key={`${side}w${piece.from}`} x={x} y={y} width={w} height={h} fill="#fff" stroke={INK} strokeWidth={LINE * 0.8} />);
        parts.push(horizontal
          ? <line key={`${side}wl${piece.from}`} x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke={INK} strokeWidth={LINE * 0.8} />
          : <line key={`${side}wl${piece.from}`} x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke={INK} strokeWidth={LINE * 0.8} />);
      }
      if (piece.kind === "door" && piece.opening) {
        const { hinge, closedEnd, openEnd } = doorGeometry(room, piece.opening);
        const r = piece.opening.width;
        // Sweep direction so the arc runs from the open leaf to the closed position.
        const cross = (openEnd[0] - hinge[0]) * (closedEnd[1] - hinge[1]) - (openEnd[1] - hinge[1]) * (closedEnd[0] - hinge[0]);
        parts.push(<g key={`${side}d${piece.from}`}>
          <line x1={hinge[0]} y1={hinge[1]} x2={openEnd[0]} y2={openEnd[1]} stroke={INK} strokeWidth={LINE * 2} />
          <path d={`M ${openEnd[0]} ${openEnd[1]} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${closedEnd[0]} ${closedEnd[1]}`} fill="none" stroke={INK} strokeWidth={LINE * 0.8} />
          <circle cx={hinge[0]} cy={hinge[1]} r={0.03} fill={INK} />
        </g>);
      }
    }
  }
  return <g>{parts}</g>;
}

/** Architectural dimension: |◄── label ──►| with end ticks, arrowheads and a gap in the line for the label. */
function Dimension({ x1, y1, x2, y2, label, vertical }: { x1: number; y1: number; x2: number; y2: number; label: string; vertical?: boolean }) {
  const tick = 0.14;
  const arrow = 0.14;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const gap = Math.min(length / 2 - arrow - 0.05, label.length * 0.058 + 0.12);
  // Work along a local axis (u) and map to x/y.
  const at = (u: number, v = 0): [number, number] => (vertical ? [cx + v, cy + u] : [cx + u, cy + v]);
  const half = length / 2;
  const seg = (a: [number, number], b: [number, number], key: string) => <line key={key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
  const head = (side: number) => {
    const tip = at(side * half);
    const base1 = at(side * (half - arrow), arrow * 0.35);
    const base2 = at(side * (half - arrow), -arrow * 0.35);
    return <polygon key={"a" + side} points={`${tip.join(",")} ${base1.join(",")} ${base2.join(",")}`} fill={INK} stroke="none" />;
  };
  return (
    <g stroke={INK} strokeWidth={LINE * 0.7}>
      {seg(at(-half), at(-gap), "l")}
      {seg(at(gap), at(half), "r")}
      {seg(at(-half, -tick), at(-half, tick), "t1")}
      {seg(at(half, -tick), at(half, tick), "t2")}
      {head(-1)}
      {head(1)}
      <text x={cx} y={cy} fontSize={0.2} fill={INK} stroke="none" textAnchor="middle" dominantBaseline="central" transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>{label}</text>
    </g>
  );
}

/**
 * Architectural floor plan of the active room, drawn as SVG from canonical scene data. Doors show hinge
 * and swing arcs; furniture can be selected and dragged (one undoable move per drag).
 */
export function FloorPlan() {
  const scene = useWorkspaceStore((state) => state.scene);
  const activeRoomId = useWorkspaceStore((state) => state.activeRoomId);
  const selectedId = useWorkspaceStore((state) => state.selectedEntityId);
  const validation = useWorkspaceStore((state) => state.validation);
  const peers = useWorkspaceStore((state) => state.peers);
  const selfId = useWorkspaceStore((state) => state.selfId);
  const { selectEntity, dispatch } = useWorkspaceStore.getState();
  const room = scene.rooms.find((entry) => entry.id === activeRoomId) ?? scene.rooms[0];
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number; x: number; z: number; base: number; moved: boolean } | null>(null);
  const flagged = useMemo(() => new Set((validation?.issues ?? []).filter((issue) => issue.severity !== "info").flatMap((issue) => issue.objectIds)), [validation]);
  if (!room) return null;

  const { width: W, depth: D, wallThickness: t } = room.dimensions;
  const margin = 1.1;
  const items = scene.furniture.filter((item) => item.roomId === room.id && item.position.y - room.position.y < 1.9);
  // Floor coverings first, so furniture draws on top of rugs.
  items.sort((a, b) => Number(!isFloorCovering(a)) - Number(!isFloorCovering(b)));
  const toLocal = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return [local.x, local.y] as const;
  };
  const area = W * D;

  return (
    <div className="floor-plan">
      <svg
        ref={svgRef}
        viewBox={`${-W / 2 - t - margin} ${-D / 2 - t - margin} ${W + 2 * t + 2 * margin} ${D + 2 * t + 2 * margin}`}
        onPointerMove={(event) => {
          const [px, py] = toLocal(event.clientX, event.clientY);
          const [cx, cz] = rotateYaw([px, py], room.yawDegrees);
          useWorkspaceStore.getState().sendCursor({ x: room.position.x + cx, y: room.position.y, z: room.position.z + cz, roomId: room.id });
          if (!dragging) return;
          const [x, y] = toLocal(event.clientX, event.clientY);
          setDragging({ ...dragging, x: Math.round((x - dragging.dx) / 0.05) * 0.05, z: Math.round((y - dragging.dy) / 0.05) * 0.05, moved: true });
        }}
        onPointerUp={() => {
          if (!dragging) return;
          if (dragging.moved) {
            // Plan coordinates are room-local; convert back to world for the canonical action.
            const [wx, wz] = rotateYaw([dragging.x, dragging.z], room.yawDegrees);
            dispatch({ type: "furniture.update", furnitureId: dragging.id, patch: { position: { x: Math.round((room.position.x + wx) * 1000) / 1000, z: Math.round((room.position.z + wz) * 1000) / 1000 } } }, { base: { [dragging.id]: dragging.base } });
          }
          setDragging(null);
        }}
        onPointerDown={(event) => {
          if (event.target === svgRef.current) selectEntity("");
        }}
      >
        <rect x={-W / 2} y={-D / 2} width={W} height={D} fill="#fff" />
        {items.map((item) => {
          const [lx, lz] = worldToRoom(room, [item.position.x, item.position.z]);
          const live = dragging?.id === item.id && dragging.moved ? [dragging.x, dragging.z] : [lx, lz];
          const yaw = item.yawDegrees - room.yawDegrees;
          return (
            <g
              key={item.id}
              className={"plan-item" + (item.id === selectedId ? " plan-item--selected" : "") + (flagged.has(item.id) ? " plan-item--flagged" : "")}
              // SVG y = room +Z; a yaw of θ about +Y appears as −θ in this top-down (y-down) drawing.
              transform={`translate(${live[0]} ${live[1]}) rotate(${-yaw})`}
              onPointerDown={(event) => {
                event.stopPropagation();
                selectEntity(item.id);
                if (item.constraints?.locked) return;
                const [x, y] = toLocal(event.clientX, event.clientY);
                (event.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(event.pointerId);
                setDragging({ id: item.id, dx: x - lx, dy: y - lz, x: lx, z: lz, base: item.version, moved: false });
              }}
            >
              <title>{item.name}</title>
              <Symbol item={item} />
            </g>
          );
        })}
        <Walls room={room} />
        {peers.filter((peer) => peer.clientId !== selfId && peer.cursor?.roomId === room.id).map((peer) => {
          const [cx, cz] = worldToRoom(room, [peer.cursor!.x, peer.cursor!.z]);
          return (
            <g key={peer.clientId} transform={`translate(${cx} ${cz})`} pointerEvents="none">
              <path d="M 0 0 L 0 0.32 L 0.09 0.24 L 0.2 0.28 Z" fill={peer.color} stroke="#fff" strokeWidth={0.015} />
              <rect x={0.12} y={0.3} width={peer.name.length * 0.1 + 0.12} height={0.2} rx={0.05} fill={peer.color} />
              <text x={0.18} y={0.44} fontSize={0.13} fill="#fff" fontWeight={600}>{peer.name}</text>
            </g>
          );
        })}
        <text x={0} y={-0.12} fontSize={0.26} textAnchor="middle" fill={INK} fontWeight={600}>{room.name.split("·").pop()!.trim()}</text>
        <text x={0} y={0.2} fontSize={0.2} textAnchor="middle" fill="#555">{area.toFixed(1)} m² · {Math.round(area * M_TO_FT * M_TO_FT)} sq ft</text>
        <Dimension x1={-W / 2 - t} y1={-D / 2 - t - 0.55} x2={W / 2 + t} y2={-D / 2 - t - 0.55} label={`${W.toFixed(2)} m (${feetInches(W)})`} />
        <Dimension x1={-W / 2 - t - 0.55} y1={-D / 2} x2={-W / 2 - t - 0.55} y2={D / 2} label={`${D.toFixed(2)} m (${feetInches(D)})`} vertical />
        <g transform={`translate(${W / 2 + t + 0.55} ${D / 2 + t + 0.55})`}>
          <circle r={0.32} fill="#fff" stroke={INK} strokeWidth={LINE * 0.7} />
          <path d="M 0 -0.3 L 0.09 0 L 0 0.3 L -0.09 0 Z" fill="#fff" stroke={INK} strokeWidth={LINE * 0.7} />
          <path d="M 0 -0.3 L 0.09 0 L -0.09 0 Z" fill={INK} />
          <text y={-0.38} fontSize={0.16} textAnchor="middle" fill={INK} transform={`rotate(${-scene.environment.northOffsetDegrees})`}>N</text>
        </g>
      </svg>
    </div>
  );
}
