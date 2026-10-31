import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Plane, Raycaster, Vector2, Vector3, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { ArrowUpDown, Copy, Crosshair, Lock, RotateCw, Trash2, Unlock } from "lucide-react";
import type { FurnitureObject, Room, Scene } from "@reality-builder/shared";
import { footprint, isFloorCovering, polygonAabb, satPenetration, worldToRoom, type Polygon } from "@reality-builder/spatial-engine";
import { useWorkspaceStore } from "../../store/workspace";
import { duplicate } from "../panels/Inspector";

const DEG = Math.PI / 180;
const MOVE_SNAP = 0.05;
const ROTATE_SNAP = 15;
const WALL_MAGNET = 0.12;

type DragKind = "move" | "rotate" | "elevate";

type DragState = {
  kind: DragKind;
  item: FurnitureObject;
  group: Group;
  base: Record<string, number>;
  startClient: [number, number];
  /** move: pointer→object offset on the drag plane; rotate: start angle; elevate: start y. */
  offset: [number, number];
  startAngle: number;
  moved: boolean;
  obstacles: Polygon[];
  room: Room | undefined;
};

/** Shared, mutable drag session (kept out of React state so dragging never re-renders the app). */
export const drag: {
  state: DragState | null;
  feedback: { colliding: boolean; label: string };
  /** Installed by DragController (needs the camera). */
  floorPoint: ((clientX: number, clientY: number, height: number) => Vector3 | null) | null;
  setControls: ((enabled: boolean) => void) | null;
} = {
  state: null,
  feedback: { colliding: false, label: "" },
  floorPoint: null,
  setControls: null,
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((listener) => listener());
}
function useDragFeedback() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return drag.feedback;
}

function roomOf(scene: Scene, item: FurnitureObject) {
  return scene.rooms.find((room) => room.id === item.roomId);
}

/** Begin a drag; called from pointer-down on an object or a handle. */
export function beginDrag(kind: DragKind, item: FurnitureObject, group: Group, clientX: number, clientY: number) {
  const { scene } = useWorkspaceStore.getState();
  if (item.constraints?.locked) {
    useWorkspaceStore.getState().notify("info", `${item.name} is locked. Unlock it to move it.`);
    return;
  }
  const room = roomOf(scene, item);
  const obstacles = scene.furniture
    .filter((other) => other.id !== item.id && other.roomId === item.roomId && !isFloorCovering(other) && !isFloorCovering(item))
    // Only things at overlapping heights can collide.
    .filter((other) => Math.min(other.position.y + other.dimensions.height, item.position.y + item.dimensions.height) - Math.max(other.position.y, item.position.y) > 0.005)
    .map(footprint);
  const hit = drag.floorPoint?.(clientX, clientY, item.position.y);
  drag.state = {
    kind, item, group, room, obstacles,
    base: { [item.id]: item.version },
    startClient: [clientX, clientY],
    offset: hit ? [item.position.x - hit.x, item.position.z - hit.z] : [0, 0],
    startAngle: hit ? Math.atan2(hit.x - item.position.x, hit.z - item.position.z) : 0,
    moved: false,
  };
  // Stop OrbitControls from also orbiting with this pointer.
  drag.setControls?.(false);
}

/** Clamp a footprint inside the room and pull it flush against walls that are within the magnet distance. */
function constrainToRoom(room: Room | undefined, item: FurnitureObject, x: number, z: number): [number, number] {
  if (!room) return [x, z];
  const probe = { ...item, position: { ...item.position, x, z } };
  const local = footprint(probe).map((point) => worldToRoom(room, point));
  const minX = Math.min(...local.map((point) => point[0]));
  const maxX = Math.max(...local.map((point) => point[0]));
  const minZ = Math.min(...local.map((point) => point[1]));
  const maxZ = Math.max(...local.map((point) => point[1]));
  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  let dx = 0;
  let dz = 0;
  if (minX < -halfW + WALL_MAGNET) dx = -halfW - minX;
  else if (maxX > halfW - WALL_MAGNET) dx = halfW - maxX;
  if (minZ < -halfD + WALL_MAGNET) dz = -halfD - minZ;
  else if (maxZ > halfD - WALL_MAGNET) dz = halfD - maxZ;
  // Convert the room-local correction back to world space.
  const yaw = room.yawDegrees * DEG;
  return [x + dx * Math.cos(yaw) + dz * Math.sin(yaw), z - dx * Math.sin(yaw) + dz * Math.cos(yaw)];
}

/** Lives inside the Canvas: turns pointer motion into live transforms, then commits one action on release. */
export function DragController() {
  const { camera, gl, controls } = useThree();
  const raycaster = useMemo(() => new Raycaster(), []);

  useEffect(() => {
    const floorPoint = (clientX: number, clientY: number, height: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
      return raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -height), new Vector3());
    };
    const setControls = (enabled: boolean) => {
      if (controls) (controls as unknown as { enabled: boolean }).enabled = enabled;
    };

    drag.floorPoint = floorPoint;
    drag.setControls = setControls;

    const onMove = (event: PointerEvent) => {
      const state = drag.state;
      if (!state) return;
      if (!state.moved && Math.hypot(event.clientX - state.startClient[0], event.clientY - state.startClient[1]) < 4) return;
      state.moved = true;
      const { item, group } = state;
      if (state.kind === "move") {
        const hit = floorPoint(event.clientX, event.clientY, item.position.y);
        if (!hit) return;
        let x = hit.x + state.offset[0];
        let z = hit.z + state.offset[1];
        if (!event.altKey) {
          x = Math.round(x / MOVE_SNAP) * MOVE_SNAP;
          z = Math.round(z / MOVE_SNAP) * MOVE_SNAP;
        }
        [x, z] = constrainToRoom(state.room, { ...item, yawDegrees: (group.rotation.y / DEG) }, x, z);
        group.position.x = x;
        group.position.z = z;
        const probe = footprint({ ...item, position: { ...item.position, x, z }, yawDegrees: group.rotation.y / DEG });
        const box = polygonAabb(probe);
        drag.feedback = {
          colliding: state.obstacles.some((other) => {
            const otherBox = polygonAabb(other);
            return otherBox.minX < box.maxX && otherBox.maxX > box.minX && otherBox.minZ < box.maxZ && otherBox.maxZ > box.minZ && satPenetration(probe, other) > 0.005;
          }),
          label: `x ${x.toFixed(2)} · z ${z.toFixed(2)}`,
        };
      } else if (state.kind === "rotate") {
        const hit = floorPoint(event.clientX, event.clientY, item.position.y);
        if (!hit) return;
        const angle = Math.atan2(hit.x - item.position.x, hit.z - item.position.z);
        let yaw = item.yawDegrees + (angle - state.startAngle) / DEG;
        if (!event.altKey) yaw = Math.round(yaw / ROTATE_SNAP) * ROTATE_SNAP;
        yaw = ((yaw % 360) + 360) % 360;
        group.rotation.y = yaw * DEG;
        const probe = footprint({ ...item, yawDegrees: yaw });
        drag.feedback = { colliding: state.obstacles.some((other) => satPenetration(probe, other) > 0.005), label: `${Math.round(yaw)}°` };
      } else {
        const dy = (state.startClient[1] - event.clientY) * 0.005;
        let y = Math.max(state.room?.position.y ?? 0, item.position.y + dy);
        if (!event.altKey) y = Math.round(y / 0.01) * 0.01;
        group.position.y = y;
        drag.feedback = { colliding: false, label: `elevation ${(y - (state.room?.position.y ?? 0)).toFixed(2)} m` };
      }
      emit();
    };

    const onUp = () => {
      const state = drag.state;
      if (!state) return;
      drag.state = null;
      setControls(true);
      const { item, group } = state;
      const wasMoved = state.moved;
      drag.feedback = { colliding: false, label: "" };
      emit();
      if (!wasMoved) return;
      const { dispatch } = useWorkspaceStore.getState();
      const r = (value: number) => Math.round(value * 1000) / 1000;
      let ok = false;
      if (state.kind === "move") ok = dispatch({ type: "furniture.update", furnitureId: item.id, patch: { position: { x: r(group.position.x), z: r(group.position.z) } } }, { base: state.base });
      else if (state.kind === "rotate") ok = dispatch({ type: "furniture.update", furnitureId: item.id, patch: { yawDegrees: r(((group.rotation.y / DEG) % 360 + 360) % 360) } }, { base: state.base });
      else ok = dispatch({ type: "furniture.update", furnitureId: item.id, patch: { position: { y: r(group.position.y) } } }, { base: state.base });
      if (!ok) {
        group.position.set(item.position.x, item.position.y, item.position.z);
        group.rotation.set(0, item.yawDegrees * DEG, 0);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      drag.floorPoint = null;
      drag.setControls = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [camera, gl, controls, raycaster]);
  return null;
}

/** Floor ring (drag to rotate), drag status, and floating quick actions around the selected object. */
export function SelectionHandles({ item, group }: { item: FurnitureObject; group: Group }) {
  const feedback = useDragFeedback();
  const ringRef = useRef<Mesh>(null);
  const radius = Math.hypot(item.dimensions.width, item.dimensions.depth) / 2 + 0.18;
  const locked = !!item.constraints?.locked;
  const dragging = drag.state?.item.id === item.id;
  const color = dragging && feedback.colliding ? "#e5483d" : "#1f7a5c";

  useEffect(() => {
    const material = ringRef.current?.material as MeshBasicMaterial | undefined;
    if (material) material.color.set(color);
  }, [color]);

  const start = (kind: DragKind) => (event: { stopPropagation: () => void; nativeEvent: PointerEvent; button?: number }) => {
    if ((event.nativeEvent.button ?? 0) !== 0) return;
    event.stopPropagation();
    beginDrag(kind, item, group, event.nativeEvent.clientX, event.nativeEvent.clientY);
  };

  // Follow the group while it is dragged (position only; ring stays flat).
  const followRef = useRef<Group>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (followRef.current) followRef.current.position.set(group.position.x, group.position.y, group.position.z);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [group]);

  const front = useMemo(() => {
    const yaw = item.yawDegrees * DEG;
    return [Math.sin(yaw) * radius, Math.cos(yaw) * radius] as const;
  }, [item.yawDegrees, radius]);

  const { dispatch, requestFocus, selectEntity } = useWorkspaceStore.getState();
  const act = (handler: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    handler();
  };

  return (
    <group ref={followRef}>
      {!locked ? (
        <>
          <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} onPointerDown={start("rotate")}>
            <ringGeometry args={[radius - 0.035, radius + 0.035, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
          </mesh>
          <mesh position={[front[0], 0.03, front[1]]} onPointerDown={start("rotate")}>
            <sphereGeometry args={[0.07, 20, 20]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </>
      ) : null}
      {dragging && feedback.label ? (
        <Html position={[0, item.dimensions.height + 0.35, 0]} center zIndexRange={[20, 0]}>
          <div className={"drag-label" + (feedback.colliding ? " drag-label--bad" : "")}>{feedback.label}{feedback.colliding ? " · overlapping" : ""}</div>
        </Html>
      ) : null}
      {!dragging ? (
        <Html position={[0, item.dimensions.height + 0.25, 0]} center zIndexRange={[20, 0]}>
          <div className="float-actions" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" title="Duplicate (⌘D)" onClick={act(() => duplicate(item))}><Copy size={14} /></button>
            <button type="button" title="Rotate 90°" disabled={locked} onClick={act(() => dispatch({ type: "furniture.update", furnitureId: item.id, patch: { yawDegrees: (item.yawDegrees + 90) % 360 } }, { base: { [item.id]: item.version } }))}><RotateCw size={14} /></button>
            <button type="button" title="Drag up/down to change elevation" disabled={locked} className="float-actions-drag"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                beginDrag("elevate", item, group, event.clientX, event.clientY);
              }}><ArrowUpDown size={14} /></button>
            <button type="button" title="Frame (F)" onClick={act(requestFocus)}><Crosshair size={14} /></button>
            <button type="button" title={locked ? "Unlock" : "Lock"} onClick={act(() => dispatch({ type: "furniture.update", furnitureId: item.id, patch: { constraints: { ...item.constraints, locked: !locked } } }, { base: { [item.id]: item.version } }))}>{locked ? <Unlock size={14} /> : <Lock size={14} />}</button>
            <button type="button" title="Delete (Del)" className="danger" onClick={act(() => {
              if (dispatch({ type: "furniture.delete", furnitureId: item.id }, { base: { [item.id]: item.version } })) selectEntity("");
            })}><Trash2 size={14} /></button>
          </div>
        </Html>
      ) : null}
    </group>
  );
}


/** Broadcasts this user's floor pointer and draws other collaborators' live cursors on the active floor. */
export function PresenceCursors() {
  const { gl } = useThree();
  const peers = useWorkspaceStore((state) => state.peers);
  const selfId = useWorkspaceStore((state) => state.selfId);
  const activeRoomId = useWorkspaceStore((state) => state.activeRoomId);
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const { scene, activeRoomId: roomId, sendCursor } = useWorkspaceStore.getState();
      const room = scene.rooms.find((entry) => entry.id === roomId);
      if (!room || event.target !== gl.domElement || !drag.floorPoint) return;
      const hit = drag.floorPoint(event.clientX, event.clientY, room.position.y);
      if (hit) sendCursor({ x: hit.x, y: room.position.y, z: hit.z, roomId: room.id });
    };
    const onLeave = () => useWorkspaceStore.getState().sendCursor(null);
    window.addEventListener("pointermove", onMove);
    gl.domElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      gl.domElement.removeEventListener("pointerleave", onLeave);
    };
  }, [gl]);
  return (
    <>
      {peers.filter((peer) => peer.clientId !== selfId && peer.cursor && peer.cursor.roomId === activeRoomId).map((peer) => (
        <group key={peer.clientId} position={[peer.cursor!.x, peer.cursor!.y + 0.02, peer.cursor!.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <ringGeometry args={[0.08, 0.13, 32]} />
            <meshBasicMaterial color={peer.color} transparent opacity={0.9} depthWrite={false} />
          </mesh>
          <Html position={[0, 0.25, 0]} center zIndexRange={[15, 0]}>
            <div className="peer-cursor" style={{ background: peer.color }}>{peer.name}</div>
          </Html>
        </group>
      ))}
    </>
  );
}
