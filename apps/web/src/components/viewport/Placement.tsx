import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { FurnitureObject } from "@reality-builder/shared";
import { catalogById } from "../../data/catalog";
import { activeRoom, placeEntry, resolvePose, usePlacement } from "../../lib/placement";
import { useWorkspaceStore } from "../../store/workspace";
import { drag } from "./Interaction";
import { FurnitureModel } from "./FurnitureModel";

const DEG = Math.PI / 180;

/** Pose for a screen point over the active floor (shared by drag-over and click-to-place). */
export function poseAt(entryId: string, clientX: number, clientY: number) {
  const entry = catalogById(entryId);
  const { scene } = useWorkspaceStore.getState();
  const room = activeRoom(scene);
  if (!entry || !room || !drag.floorPoint) return null;
  const hit = drag.floorPoint(clientX, clientY, room.position.y);
  return hit ? resolvePose(entry, room, scene, hit.x, hit.z) : null;
}

/** Translucent-footprint preview of the exact catalog model that follows the pointer. */
export function PlacementGhost() {
  const entryId = usePlacement((state) => state.entryId);
  const pose = usePlacement((state) => state.pose);
  const entry = catalogById(entryId ?? undefined);
  const scene = useWorkspaceStore((state) => state.scene);
  const room = activeRoom(scene);
  if (!entry || !pose || !room) return null;
  const item: FurnitureObject = {
    id: "ghost", roomId: room.id, name: entry.name, category: entry.category, catalogItemId: entry.id,
    position: { x: pose.x, y: room.position.y + (entry.elevation ?? 0), z: pose.z }, yawDegrees: pose.yaw,
    dimensions: entry.dimensions, color: entry.color, version: 1,
  };
  const color = pose.valid ? "#2f9e6e" : "#e5483d";
  return (
    <group position={[item.position.x, item.position.y, item.position.z]} rotation={[0, pose.yaw * DEG, 0]} raycast={() => null}>
      <FurnitureModel item={item} lowDetail={false} castShadow={false} lightOn={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01 - (entry.elevation ?? 0), 0]} raycast={() => null}>
        <planeGeometry args={[entry.dimensions.width + 0.06, entry.dimensions.depth + 0.06]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Click-to-place: while an item is armed, the ghost follows the pointer and a click on the floor places it. */
export function PlacementController() {
  const { gl } = useThree();
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const { mode, entryId, update } = usePlacement.getState();
      if (mode !== "click" || !entryId) return;
      if (event.target !== gl.domElement) {
        update(null);
        return;
      }
      update(poseAt(entryId, event.clientX, event.clientY));
    };
    const onDown = (event: PointerEvent) => {
      const { mode, entryId, cancel } = usePlacement.getState();
      if (mode !== "click" || !entryId || event.target !== gl.domElement || event.button !== 0) return;
      // Capture phase: consume the click so it does not also select or start a drag.
      event.stopPropagation();
      const pose = poseAt(entryId, event.clientX, event.clientY);
      if (!pose) return;
      placeEntry(entryId, { x: pose.x, z: pose.z });
      if (!event.shiftKey) cancel(); // Shift-click keeps placing copies.
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && usePlacement.getState().entryId) usePlacement.getState().cancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [gl]);
  return null;
}
