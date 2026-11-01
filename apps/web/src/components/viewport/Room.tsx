import { Component, memo, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Line, Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { ArrowLeftRight, DoorOpen, FlipHorizontal2, Minus, Plus, Trash2, X } from "lucide-react";
import { addDoor, commitOpening, openingHeight, removeOpening, resizeEdge, setWidth, slide, useOpeningSelection } from "../../lib/openings";
import { drag } from "./Interaction";
import { useWorkspaceStore } from "../../store/workspace";
import { CanvasTexture, Matrix4, MathUtils, Plane, RepeatWrapping, SRGBColorSpace, Vector3, type Group } from "three";
import type { Opening, Room, WallSide } from "@reality-builder/shared";

const DEG = Math.PI / 180;

/**
 * 3D text fetches glyph data from a CDN. If that is slow or blocked (strict campus/venue Wi-Fi), the label must not
 * hold the whole editor on its loading screen: it renders nothing until ready, and nothing at all if it fails.
 */
class LabelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function OptionalLabel({ children }: { children: ReactNode }) {
  return <LabelBoundary><Suspense fallback={null}>{children}</Suspense></LabelBoundary>;
}
const CUTAWAY_HEIGHT = 0.18;

type Segment = { from: number; to: number; bottom: number; top: number };

/** Splits one wall into solid pieces around its openings (along-wall coordinate, centered on the wall). */
function wallSegments(length: number, height: number, openings: Opening[]): Segment[] {
  const sorted = [...openings].sort((a, b) => a.offset - b.offset);
  const segments: Segment[] = [];
  let cursor = -length / 2;
  for (const opening of sorted) {
    const start = Math.max(-length / 2, opening.offset - opening.width / 2);
    const end = Math.min(length / 2, opening.offset + opening.width / 2);
    if (start > cursor) segments.push({ from: cursor, to: start, bottom: 0, top: height });
    if (opening.sillHeight > 0) segments.push({ from: start, to: end, bottom: 0, top: opening.sillHeight });
    const head = Math.min(height, opening.sillHeight + opening.height);
    if (head < height) segments.push({ from: start, to: end, bottom: head, top: height });
    cursor = Math.max(cursor, end);
  }
  if (cursor < length / 2) segments.push({ from: cursor, to: length / 2, bottom: 0, top: height });
  return segments;
}

const WALL_FRAMES: Record<WallSide, { normal: [number, number]; yaw: number }> = {
  north: { normal: [0, -1], yaw: 0 },
  south: { normal: [0, 1], yaw: 180 },
  west: { normal: [-1, 0], yaw: 90 },
  east: { normal: [1, 0], yaw: -90 },
};

function Wall({ room, side, cutaway }: { room: Room; side: WallSide; cutaway: boolean }) {
  const groupRef = useRef<Group>(null);
  const { width, depth, height, wallThickness: t } = room.dimensions;
  const horizontal = side === "north" || side === "south";
  const length = horizontal ? width + 2 * t : depth;
  const draft = useOpeningSelection((state) => (state.roomId === room.id ? state.draft : null));
  const openings = useMemo(() => room.openings.map((opening) => (draft && opening.id === draft.id ? draft : opening)).filter((opening) => opening.wall === side), [room.openings, draft, side]);
  const segments = useMemo(() => wallSegments(length, height, openings), [length, height, openings]);
  const frame = WALL_FRAMES[side];
  const center: [number, number] = horizontal ? [0, frame.normal[1] * (depth / 2 + t / 2)] : [frame.normal[0] * (width / 2 + t / 2), 0];
  const local = useMemo(() => new Vector3(), []);

  // Lower walls that stand between the camera and the room interior.
  useFrame(({ camera }, delta) => {
    const group = groupRef.current;
    const roomGroup = group?.parent?.parent;
    if (!group || !roomGroup) return;
    local.copy(camera.position);
    roomGroup.worldToLocal(local);
    const facing = cutaway && (local.x * frame.normal[0] + local.z * frame.normal[1] > (horizontal ? depth : width) / 2);
    const target = facing ? CUTAWAY_HEIGHT / height : 1;
    group.scale.y = MathUtils.damp(group.scale.y, target, 10, delta);
  });

  // The engine measures offsets along world +X (north/south) or +Z (east/west); the wall's yaw flips
  // local +X to point backwards along that axis for the south and west walls.
  const alongSign = side === "south" || side === "west" ? -1 : 1;
  return (
    <group position={[center[0], 0, center[1]]} rotation={[0, frame.yaw * DEG, 0]}>
      <group ref={groupRef} userData={{ cutawayWall: { normal: frame.normal, half: (horizontal ? depth : width) / 2, cutaway: CUTAWAY_HEIGHT / height } }}>
        {segments.map((segment, index) => (
          <mesh key={index} position={[((segment.from + segment.to) / 2) * alongSign, (segment.bottom + segment.top) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[segment.to - segment.from, segment.top - segment.bottom, t]} />
            <meshStandardMaterial color={room.wallColor} roughness={0.92} />
          </mesh>
        ))}
        {/* Dark cap reads the wall outline from above, as in plan drawings. */}
        {segments.filter((segment) => segment.top === height).map((segment, index) => (
          <mesh key={"cap" + index} position={[((segment.from + segment.to) / 2) * alongSign, height + 0.004, 0]}>
            <boxGeometry args={[segment.to - segment.from, 0.008, t + 0.002]} />
            <meshStandardMaterial color="#3d4542" roughness={0.6} />
          </mesh>
        ))}
        {openings.map((opening) => (
          <EditableOpening key={opening.id} room={room} opening={opening} alongSign={alongSign} thickness={t} />
        ))}
      </group>
    </group>
  );
}

function OpeningModel({ opening, along, thickness }: { opening: Opening; along: number; thickness: number }) {
  const frame = 0.05;
  if (opening.kind === "window") {
    const y = opening.sillHeight + opening.height / 2;
    return (
      <group position={[along, y, 0]}>
        <mesh>
          <boxGeometry args={[opening.width, opening.height, 0.02]} />
          <meshPhysicalMaterial color="#cfe6f3" transmission={0.9} roughness={0.05} thickness={0.02} transparent opacity={0.35} />
        </mesh>
        {[[0, opening.height / 2 - frame / 2, opening.width, frame], [0, -opening.height / 2 + frame / 2, opening.width, frame], [-opening.width / 2 + frame / 2, 0, frame, opening.height], [opening.width / 2 - frame / 2, 0, frame, opening.height], [0, 0, frame * 0.6, opening.height]].map(([x, yy, w, h], index) => (
          <mesh key={index} position={[x!, yy!, 0]}>
            <boxGeometry args={[w!, h!, thickness + 0.01]} />
            <meshStandardMaterial color="#f7f6f2" roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, -opening.height / 2 - 0.02, thickness / 2 + 0.04]}>
          <boxGeometry args={[opening.width + 0.08, 0.03, 0.1]} />
          <meshStandardMaterial color="#efece6" roughness={0.6} />
        </mesh>
      </group>
    );
  }
  const trim = <OpeningTrim opening={opening} along={along} thickness={thickness} />;
  // Open passage: a lined, trimmed gap in the wall.
  if (opening.kind === "passage") return trim;
  // Door: frame + leaf shown ajar. Wall-local +Z points into the room and −X is "left" seen from inside.
  const leafWidth = opening.width - frame * 2;
  const hingeSign = opening.hinge === "right" ? 1 : -1;
  const swingIn = opening.swing !== "out";
  const angle = (swingIn ? 1 : -1) * hingeSign * 35 * DEG;
  return (
    <>
    {trim}
    <group position={[along, 0, 0]}>
      {[[-opening.width / 2 + frame / 2, opening.height / 2, frame, opening.height], [opening.width / 2 - frame / 2, opening.height / 2, frame, opening.height], [0, opening.height - frame / 2, opening.width, frame]].map(([x, y, w, h], index) => (
        <mesh key={index} position={[x!, y!, 0]}>
          <boxGeometry args={[w!, h!, thickness + 0.02]} />
          <meshStandardMaterial color="#f2efe9" roughness={0.5} />
        </mesh>
      ))}
      <group position={[hingeSign * (opening.width / 2 - frame), 0, (swingIn ? 1 : -1) * thickness / 2]} rotation={[0, angle, 0]}>
        <mesh position={[-hingeSign * leafWidth / 2, (opening.height - frame) / 2, (swingIn ? 1 : -1) * 0.02]} castShadow>
          <boxGeometry args={[leafWidth, opening.height - frame, 0.04]} />
          <meshStandardMaterial color="#d9cbb6" roughness={0.6} />
        </mesh>
        <mesh position={[-hingeSign * (leafWidth - 0.08), 1.0, (swingIn ? 1 : -1) * 0.06]}>
          <sphereGeometry args={[0.025, 12, 12]} />
          <meshStandardMaterial color="#b9b2a5" metalness={0.8} roughness={0.25} />
        </mesh>
      </group>
    </group>
    </>
  );
}

const TRIM = "#f4f1eb";
/** Architrave on both wall faces, jamb lining through the wall and a floor threshold, so openings read as built. */
function OpeningTrim({ opening, along, thickness }: { opening: Opening; along: number; thickness: number }) {
  const casing = 0.07;
  const depth = 0.018;
  const h = opening.height;
  const w = opening.width;
  return (
    <group position={[along, 0, 0]}>
      {[-1, 1].map((face) => (
        <group key={face} position={[0, 0, face * (thickness / 2 + depth / 2)]}>
          <mesh position={[-w / 2 - casing / 2, h / 2, 0]}><boxGeometry args={[casing, h, depth]} /><meshStandardMaterial color={TRIM} roughness={0.45} /></mesh>
          <mesh position={[w / 2 + casing / 2, h / 2, 0]}><boxGeometry args={[casing, h, depth]} /><meshStandardMaterial color={TRIM} roughness={0.45} /></mesh>
          <mesh position={[0, h + casing / 2, 0]}><boxGeometry args={[w + casing * 2, casing, depth]} /><meshStandardMaterial color={TRIM} roughness={0.45} /></mesh>
        </group>
      ))}
      {opening.kind === "passage" ? (
        <>
          <mesh position={[-w / 2 + 0.006, h / 2, 0]}><boxGeometry args={[0.012, h, thickness]} /><meshStandardMaterial color={TRIM} roughness={0.5} /></mesh>
          <mesh position={[w / 2 - 0.006, h / 2, 0]}><boxGeometry args={[0.012, h, thickness]} /><meshStandardMaterial color={TRIM} roughness={0.5} /></mesh>
          <mesh position={[0, h - 0.006, 0]}><boxGeometry args={[w, 0.012, thickness]} /><meshStandardMaterial color={TRIM} roughness={0.5} /></mesh>
        </>
      ) : null}
      <mesh position={[0, 0.006, 0]} receiveShadow><boxGeometry args={[w, 0.012, thickness + 0.02]} /><meshStandardMaterial color="#b9a78c" roughness={0.55} /></mesh>
    </group>
  );
}

const ACCENT = "#6a3de8";
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

/**
 * A door/window/passage that can be picked in 3D: click to select, drag its body to slide along the wall,
 * drag the side handles to resize (snapped to 5 cm, never past the wall ends or a neighbouring opening),
 * and use the floating bar to flip, change type or delete. Each drag is one undoable room action.
 */
function EditableOpening({ room, opening, alongSign, thickness }: { room: Room; opening: Opening; alongSign: number; thickness: number }) {
  const base = useRef<Group>(null);
  const selected = useOpeningSelection((state) => state.roomId === room.id && state.openingId === opening.id);
  const session = useRef<{ mode: "slide" | -1 | 1; start: number; startOffset: number } | null>(null);
  const along = opening.offset * alongSign;
  const top = opening.sillHeight + opening.height;

  // Selecting furniture deselects the opening.
  useEffect(() => useWorkspaceStore.subscribe((state, prev) => {
    if (state.selectedEntityId && state.selectedEntityId !== prev.selectedEntityId && useOpeningSelection.getState().openingId) useOpeningSelection.getState().select(null, null);
  }), []);

  const wallCoord = (event: ThreeEvent<PointerEvent>) => {
    if (!base.current) return null;
    const inverse = new Matrix4().copy(base.current.matrixWorld).invert();
    const ray = event.ray.clone().applyMatrix4(inverse);
    const hit = ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
    return hit ? hit.x * alongSign : null;
  };
  const begin = (mode: "slide" | -1 | 1) => (event: ThreeEvent<PointerEvent>) => {
    if (!selected && mode !== "slide") return;
    event.stopPropagation();
    if (!selected) { useOpeningSelection.getState().select(room.id, opening.id); useWorkspaceStore.getState().selectEntity(""); }
    const at = wallCoord(event);
    if (at === null) return;
    session.current = { mode, start: at, startOffset: opening.offset };
    (event.target as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(event.pointerId);
    drag.setControls?.(false);
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    const current = session.current;
    if (!current) return;
    event.stopPropagation();
    const at = wallCoord(event);
    if (at === null) return;
    const source = room.openings.find((entry) => entry.id === opening.id) ?? opening;
    const next = current.mode === "slide"
      ? slide(room, source, current.startOffset + (at - current.start))
      : resizeEdge(room, source, (current.mode * alongSign) as -1 | 1, at);
    useOpeningSelection.getState().setDraft(next);
  };
  const end = (event: ThreeEvent<PointerEvent>) => {
    if (!session.current) return;
    event.stopPropagation();
    session.current = null;
    drag.setControls?.(true);
    const draft = useOpeningSelection.getState().draft;
    useOpeningSelection.getState().setDraft(null);
    const source = room.openings.find((entry) => entry.id === opening.id);
    if (draft && source && (draft.offset !== source.offset || draft.width !== source.width)) commitOpening(room, draft, draft.width !== source.width ? "Resize door" : "Move door");
  };

  const label = opening.kind === "passage" ? "Opening" : opening.kind === "window" ? "Window" : "Door";
  return (
    <group ref={base}>
      <OpeningModel opening={opening} along={along} thickness={thickness} />
      {/* Pick target covering the whole opening (also the slide handle). */}
      <mesh position={[along, opening.sillHeight + opening.height / 2, 0]} onPointerDown={begin("slide")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onClick={stop} onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = selected ? "ew-resize" : "pointer"; }} onPointerOut={() => (document.body.style.cursor = "")}>
        <boxGeometry args={[opening.width + 0.08, opening.height + 0.06, thickness + 0.06]} />
        <meshBasicMaterial transparent opacity={selected ? 0.08 : 0} color={ACCENT} depthWrite={false} />
      </mesh>
      {selected ? (
        <>
          <Line points={[[along - opening.width / 2, opening.sillHeight, thickness / 2 + 0.03], [along + opening.width / 2, opening.sillHeight, thickness / 2 + 0.03], [along + opening.width / 2, top, thickness / 2 + 0.03], [along - opening.width / 2, top, thickness / 2 + 0.03], [along - opening.width / 2, opening.sillHeight, thickness / 2 + 0.03]]} color={ACCENT} lineWidth={2.5} />
          {([-1, 1] as const).map((side) => (
            <mesh key={side} position={[along + side * opening.width / 2, opening.sillHeight + opening.height / 2, thickness / 2 + 0.05]}
              onPointerDown={begin(side)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClick={stop}
              onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = "col-resize"; }} onPointerOut={() => (document.body.style.cursor = "")}>
              <capsuleGeometry args={[0.045, Math.min(0.5, opening.height * 0.35), 4, 12]} />
              <meshBasicMaterial color={ACCENT} />
            </mesh>
          ))}
          <Html position={[along, top + 0.25, thickness / 2]} center zIndexRange={[30, 20]}>
            <div className="door-bar" onPointerDown={stop} onClick={stop}>
              <select value={opening.kind} aria-label="Type" onChange={(event) => {
                const kind = event.target.value as Opening["kind"];
                const height = openingHeight(room, kind);
                commitOpening(room, { ...opening, kind, height, sillHeight: kind === "window" ? Math.min(0.9, room.dimensions.height - height - 0.1) : 0 }, "Change opening type");
              }}>
                <option value="door">Door</option><option value="passage">Open passage</option><option value="window">Window</option>
              </select>
              <button type="button" title="Narrower" onClick={() => commitOpening(room, setWidth(room, opening, opening.width - 0.05), "Resize door")}><Minus size={13} /></button>
              <span className="door-width">{Math.round(opening.width * 100)} cm</span>
              <button type="button" title="Wider (stops at walls and other openings)" onClick={() => commitOpening(room, setWidth(room, opening, opening.width + 0.05), "Resize door")}><Plus size={13} /></button>
              {opening.kind === "door" ? (
                <>
                  <button type="button" title="Flip hinge side" onClick={() => commitOpening(room, { ...opening, hinge: opening.hinge === "left" ? "right" : "left" }, "Flip door")}><FlipHorizontal2 size={13} /></button>
                  <button type="button" title={opening.swing === "out" ? "Opens outward: make it open into the room" : "Opens into the room: make it open outward"} onClick={() => commitOpening(room, { ...opening, swing: opening.swing === "out" ? "in" : "out" }, "Flip door swing")}><ArrowLeftRight size={13} /></button>
                </>
              ) : null}
              <button type="button" title="Add another door on this wall" onClick={() => addDoor(room, opening.wall)}><DoorOpen size={13} /></button>
              <button type="button" className="door-bar-danger" title={`Remove ${label.toLowerCase()} (Del)`} onClick={() => removeOpening(room, opening.id)}><Trash2 size={13} /></button>
              <button type="button" title="Done (Esc)" onClick={() => useOpeningSelection.getState().select(null, null)}><X size={13} /></button>
            </div>
          </Html>
        </>
      ) : null}
    </group>
  );
}

export const RoomShell = memo(function RoomShell({ room, cutaway, showDimensions }: { room: Room; cutaway: boolean; showDimensions: boolean }) {
  const { width, depth, wallThickness: t } = room.dimensions;
  return (
    <group position={[room.position.x, room.position.y, room.position.z]} rotation={[0, room.yawDegrees * DEG, 0]}>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[width + 2 * t, 0.12, depth + 2 * t]} />
        <meshStandardMaterial color="#c9ccc6" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow userData={{ floor: true }}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={room.floorColor} roughness={0.78} map={woodGrain(width, depth)} />
      </mesh>
      {/* Subtle plank lines */}
      {Array.from({ length: Math.floor(width / 0.2) }, (_, index) => (
        <mesh key={index} position={[-width / 2 + (index + 1) * 0.2, 0.0015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.004, depth]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.05} />
        </mesh>
      )).slice(0, 120)}
      {(["north", "south", "east", "west"] as const).map((side) => (
        <Wall key={side} room={room} side={side} cutaway={cutaway} />
      ))}
      {showDimensions ? (
        <>
          <DimensionLine length={width + 2 * t} label={`${width.toFixed(2)} m`} position={[0, 0.02, depth / 2 + t + 0.4]} yaw={0} />
          <DimensionLine length={depth + 2 * t} label={`${depth.toFixed(2)} m`} position={[width / 2 + t + 0.4, 0.02, 0]} yaw={Math.PI / 2} />
        </>
      ) : null}
    </group>
  );
});

const grainCache = new Map<string, CanvasTexture>();
/** Procedural wood grain (multiplied by the floor colour), cached per floor size. */
function woodGrain(width: number, depth: number) {
  const key = width.toFixed(2) + "x" + depth.toFixed(2);
  const cached = grainCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let plank = 0; plank < 8; plank += 1) {
    const x = plank * 64;
    g.fillStyle = `rgb(0 0 0 / ${0.02 + rand() * 0.06})`;
    g.fillRect(x, 0, 64, 512);
    for (let line = 0; line < 14; line += 1) {
      g.strokeStyle = `rgb(60 35 15 / ${0.04 + rand() * 0.08})`;
      g.lineWidth = 0.6 + rand() * 1.2;
      g.beginPath();
      const lx = x + 4 + rand() * 56;
      g.moveTo(lx, 0);
      for (let y = 0; y <= 512; y += 32) g.lineTo(lx + Math.sin(y / 60 + plank + line) * 2.5, y);
      g.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(width / 1.6, depth / 1.6);
  texture.anisotropy = 4;
  grainCache.set(key, texture);
  return texture;
}

const DIM_INK = "#5a6660";

/**
 * Architectural dimension on the floor plane: |◄── label ──►| with end ticks, arrowheads,
 * and a gap in the line around the label. Drawn along local X, then rotated by `yaw`.
 */
function DimensionLine({ length, label, position, yaw }: { length: number; label: string; position: [number, number, number]; yaw: number }) {
  const half = length / 2;
  const tick = 0.14;
  const arrow = 0.12;
  const gap = Math.min(half - arrow - 0.05, label.length * 0.05 + 0.12);
  return (
    <group position={position} rotation={[0, -yaw, 0]}>
      <Line points={[[-half, 0, 0], [-gap, 0, 0]]} color={DIM_INK} lineWidth={1.4} />
      <Line points={[[gap, 0, 0], [half, 0, 0]]} color={DIM_INK} lineWidth={1.4} />
      <Line points={[[-half, 0, -tick], [-half, 0, tick]]} color={DIM_INK} lineWidth={1.4} />
      <Line points={[[half, 0, -tick], [half, 0, tick]]} color={DIM_INK} lineWidth={1.4} />
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (half - arrow / 2), 0, 0]} rotation={[-Math.PI / 2, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2]}>
          <coneGeometry args={[arrow * 0.32, arrow, 3]} />
          <meshBasicMaterial color={DIM_INK} />
        </mesh>
      ))}
      <OptionalLabel>
        <Text position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.16} color={DIM_INK} anchorX="center" anchorY="middle">
          {label}
        </Text>
      </OptionalLabel>
    </group>
  );
}
