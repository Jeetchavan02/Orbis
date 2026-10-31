import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, GizmoHelper, GizmoViewport, Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera, TransformControls } from "@react-three/drei";
import { CanvasTexture, MOUSE, NearestFilter, Plane, Raycaster, Shape, SRGBColorSpace, Vector2, Vector3, type Group, type Object3D } from "three";
import type { FurnitureObject, FurniturePatch, Room, Scene, ValidationIssue } from "@reality-builder/shared";
import type { SunStudy } from "@reality-builder/spatial-engine";
import { useWorkspaceStore, type TransformTool } from "../store/workspace";
import { usePerfStore, viewportBridge } from "../lib/perf";
import { useContextMenu } from "../lib/ui";
import { FurnitureModel } from "./viewport/FurnitureModel";
import { CutoutModel, isCutout } from "./viewport/CutoutModel";
import { RoomShell } from "./viewport/Room";
import { ARTIFICIAL_LIGHT_FACTOR, SceneEnvironment } from "./viewport/Environment";
import { MeshEditor } from "./viewport/MeshEditor";
import { hasRealisticModel, preloadModels, RealisticModel } from "./viewport/RealisticModel";
import { beginDrag, DragController, PresenceCursors, SelectionHandles } from "./viewport/Interaction";
import { PlacementController, PlacementGhost } from "./viewport/Placement";

const DEG = Math.PI / 180;
const LOW_DETAIL_THRESHOLD = 150;
const round = (value: number, step = 0.001) => Math.round(value / step) * step;

type Severity = "error" | "warning";

const FurnitureItem = memo(function FurnitureItem({
  item, selected, severity, peerColor, peerName, lowDetail, shadows, lightScale, groupRef, onSelect, draggable,
}: {
  item: FurnitureObject;
  selected: boolean;
  severity: Severity | null;
  peerColor: string | null;
  peerName: string | null;
  lowDetail: boolean;
  shadows: boolean;
  lightScale: number;
  groupRef?: (group: Group | null) => void;
  onSelect: (id: string) => void;
  /** When true, pressing on the object starts a direct drag along the floor. */
  draggable: boolean;
}) {
  const { width, depth, height } = item.dimensions;
  const light = item.light;
  const lightOn = !!light?.on && lightScale > 0;
  const outline = selected ? "#6a3de8" : severity === "error" ? "#d9443a" : severity === "warning" ? "#d9921f" : peerColor;
  return (
    <group
      ref={groupRef}
      position={[item.position.x, item.position.y, item.position.z]}
      rotation={[0, item.yawDegrees * DEG, 0]}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onSelect(item.id);
        if (draggable) beginDrag("move", item, event.eventObject as Group, event.nativeEvent.clientX, event.nativeEvent.clientY);
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.stopPropagation();
        event.nativeEvent.preventDefault();
        onSelect(item.id);
        useContextMenu.getState().open(event.nativeEvent.clientX, event.nativeEvent.clientY, item.id);
      }}
    >
      {isCutout(item) ? (
        <Suspense fallback={<FurnitureModel item={{ ...item, catalogItemId: undefined }} lowDetail castShadow={false} lightOn={false} />}>
          <CutoutModel item={item} castShadow={shadows} />
        </Suspense>
      ) : !lowDetail && hasRealisticModel(item) ? (
        // Procedural model shows while the photoreal glTF streams in.
        <Suspense fallback={<FurnitureModel item={item} lowDetail={false} castShadow={false} lightOn={lightOn} />}>
          <RealisticModel item={item} castShadow={shadows} />
        </Suspense>
      ) : (
        <FurnitureModel item={item} lowDetail={lowDetail} castShadow={shadows && !lowDetail} lightOn={lightOn} />
      )}
      {outline ? (
        <mesh position={[0, height / 2, 0]} raycast={() => null}>
          <boxGeometry args={[width + 0.02, height + 0.02, depth + 0.02]} />
          <meshBasicMaterial visible={false} />
          <Edges color={outline} lineWidth={selected || severity ? 2 : 1.5} />
        </mesh>
      ) : null}
      {severity && !lowDetail ? (
        <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <planeGeometry args={[width + 0.08, depth + 0.08]} />
          <meshBasicMaterial color={severity === "error" ? "#e5483d" : "#e6a23c"} transparent opacity={0.22} depthWrite={false} />
        </mesh>
      ) : null}
      {peerName && !selected ? (
        <Html position={[0, height + 0.15, 0]} center distanceFactor={10} zIndexRange={[10, 0]}>
          <div className="peer-tag" style={{ background: peerColor ?? "#555" }}>{peerName}</div>
        </Html>
      ) : null}
      {lightOn && light ? (
        light.kind === "spot" ? (
          <spotLight position={[0, light.height, 0]} angle={0.7} penumbra={0.6} intensity={light.intensity * lightScale} color={light.color} distance={6} decay={2}>
            <object3D attach="target" position={[0, -1, 0.35]} />
          </spotLight>
        ) : (
          <pointLight position={[0, Math.max(light.height, 0.05) - (light.height === 0 ? 0.08 : 0), 0]} intensity={light.intensity * lightScale} color={light.color} distance={9} decay={2} />
        )
      ) : null}
    </group>
  );
});

function FloorZone({ polygon, color, opacity = 0.28 }: { polygon: [number, number][]; color: string; opacity?: number }) {
  const shape = useMemo(() => {
    const result = new Shape();
    polygon.forEach(([x, z], index) => (index === 0 ? result.moveTo(x, -z) : result.lineTo(x, -z)));
    result.closePath();
    return result;
  }, [polygon]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} raycast={() => null}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <Line points={[...polygon, polygon[0]!].map(([x, z]) => [x, 0.014, z] as [number, number, number])} color={color} lineWidth={1.5} dashed dashSize={0.08} gapSize={0.05} />
    </group>
  );
}

type PreviewMove = { objectId: string; from: { x: number; z: number }; to: { x: number; z: number; yawDegrees: number } };

function RecoveryPreview({ moves, scene }: { moves: PreviewMove[]; scene: Scene }) {
  return (
    <group>
      {moves.map((move) => {
        const item = scene.furniture.find((entry) => entry.id === move.objectId);
        if (!item) return null;
        const { width, depth, height } = item.dimensions;
        return (
          <group key={move.objectId}>
            <group position={[move.to.x, item.position.y, move.to.z]} rotation={[0, move.to.yawDegrees * DEG, 0]}>
              <mesh position={[0, height / 2, 0]} raycast={() => null}>
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial color="#2f9e6e" transparent opacity={0.35} depthWrite={false} />
                <Edges color="#1f7a5c" />
              </mesh>
            </group>
            <Line points={[[move.from.x, 0.05, move.from.z], [move.to.x, 0.05, move.to.z]]} color="#1f7a5c" lineWidth={2.5} dashed dashSize={0.1} gapSize={0.06} />
          </group>
        );
      })}
    </group>
  );
}

/** Floor heat map of direct sun, drawn into a canvas texture aligned with the study grid. */
function SunOverlay({ study, room }: { study: SunStudy; room: Room }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = study.columns;
    canvas.height = study.rows;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(study.columns, study.rows);
    const max = study.mode === "daily" ? Math.max(0.5, ...study.values) : 1;
    study.values.forEach((value, index) => {
      const t = Math.min(1, value / max);
      image.data[index * 4] = 255;
      image.data[index * 4 + 1] = Math.round(200 - 90 * t);
      image.data[index * 4 + 2] = Math.round(60 - 40 * t);
      image.data[index * 4 + 3] = value > 0 ? Math.round(70 + 120 * t) : 0;
    });
    context.putImageData(image, 0, 0);
    const result = new CanvasTexture(canvas);
    result.magFilter = NearestFilter;
    result.colorSpace = SRGBColorSpace;
    return result;
  }, [study]);
  useEffect(() => () => texture.dispose(), [texture]);
  const width = study.columns * study.cellSize;
  const depth = study.rows * study.cellSize;
  return (
    <group position={[room.position.x, room.position.y + 0.02, room.position.z]} rotation={[0, room.yawDegrees * DEG, 0]}>
      <mesh position={[-room.dimensions.width / 2 + width / 2, 0, -room.dimensions.depth / 2 + depth / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={1}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

const PRESET_DIRECTIONS: Record<string, [number, number, number]> = {
  perspective: [0.62, 0.78, 0.92],
  top: [0, 1, 0.0001],
  front: [0, 0.0001, 1],
  side: [1, 0.0001, 0],
  iso: [1, 0.82, 1],
};

/** Camera for every preset; ortho presets lock rotation, walkthrough is first-person at eye height. */
function CameraRig({ scene, selectedId, room }: { scene: Scene; selectedId: string; room: Room | undefined }) {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const resetSignal = useWorkspaceStore((state) => state.resetCameraSignal);
  const focusSignal = useWorkspaceStore((state) => state.focusSignal);
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const panMode = useWorkspaceStore((state) => state.panMode);
  const get = useThree((state) => state.get);
  const span = room ? Math.max(room.dimensions.width, room.dimensions.depth) : 6;
  const ortho = viewMode === "top" || viewMode === "front" || viewMode === "side" || viewMode === "iso" || viewMode === "plan";
  const walk = viewMode === "walk";

  const frame = (center: Vector3, radius: number) => {
    const controls = controlsRef.current;
    // Always the currently active camera (it changes when switching presets).
    const { camera, size } = get();
    if (walk || !controls) return;
    (controls as unknown as { object: typeof camera }).object = camera;
    const [dx, dy, dz] = PRESET_DIRECTIONS[viewMode === "plan" ? "top" : viewMode] ?? PRESET_DIRECTIONS.perspective!;
    const direction = new Vector3(dx, dy, dz).normalize();
    if (ortho) {
      camera.position.copy(center).addScaledVector(direction, 40);
      const cam = camera as unknown as { zoom: number; updateProjectionMatrix: () => void };
      cam.zoom = Math.min(size.width, size.height) / Math.max(radius * 2.6, 1.5);
      cam.updateProjectionMatrix();
    } else {
      camera.position.copy(center).addScaledVector(direction, Math.max(2.2, radius * 2.3));
    }
    controls.target.copy(center);
    camera.lookAt(center);
    controls.update();
  };

  useEffect(() => {
    if (!room) return;
    const id = requestAnimationFrame(() => frame(new Vector3(room.position.x, room.position.y + (viewMode === "perspective" ? 0.6 : 1), room.position.z), Math.max(room.dimensions.width, room.dimensions.depth) / 2 + 0.5));
    return () => cancelAnimationFrame(id);
  }, [resetSignal, room?.id, span, viewMode]);

  useEffect(() => {
    if (focusSignal === 0) return;
    const item = scene.furniture.find((entry) => entry.id === selectedId);
    if (item) frame(new Vector3(item.position.x, item.position.y + item.dimensions.height / 2, item.position.z), Math.max(item.dimensions.width, item.dimensions.depth, item.dimensions.height));
  }, [focusSignal]);

  if (walk) return <><PerspectiveCamera key="walk" makeDefault fov={70} near={0.05} far={200} /><Walkthrough room={room} /></>;
  return (
    <>
      {ortho
        ? <OrthographicCamera key={"ortho-" + viewMode} makeDefault near={0.1} far={200} position={[0, 40, 0]} zoom={60} />
        : <PerspectiveCamera key="persp" makeDefault fov={40} near={0.05} far={600} position={[7, 6.5, 8]} />}
      <OrbitControls
        key={viewMode + (panMode ? "-pan" : "")}
        ref={controlsRef}
        makeDefault
        enableRotate={viewMode === "perspective"}
        screenSpacePanning
        maxPolarAngle={Math.PI * 0.495}
        minDistance={1}
        maxDistance={span * 4 + 20}
        minZoom={8}
        maxZoom={600}
        mouseButtons={!ortho && !panMode ? { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN } : { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
        enableDamping
        dampingFactor={0.1}
      />
    </>
  );
}

/** First-person walkthrough: drag to look around, WASD/arrow keys to walk; stays inside the room at eye height. */
function Walkthrough({ room }: { room: Room | undefined }) {
  const { camera, gl } = useThree();
  const walkMode = useWorkspaceStore((state) => state.walkMode);
  const roamRef = useRef(walkMode === "roam");
  roamRef.current = walkMode === "roam";
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: Math.PI, pitch: 0 });
  useEffect(() => {
    if (!room) return;
    camera.position.set(room.position.x, room.position.y + 1.6, room.position.z + room.dimensions.depth / 2 - 0.6);
    look.current = { yaw: 0, pitch: -0.05 };
    let dragging = false;
    const down = (event: PointerEvent) => {
      // Tour: left-drag looks. Free roam: left button edits objects, right-drag looks.
      if (event.target === gl.domElement && event.button === (roamRef.current ? 2 : 0)) dragging = true;
    };
    const up = () => (dragging = false);
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      look.current.yaw -= event.movementX * 0.004;
      look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - event.movementY * 0.004));
    };
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.type === "keydown") keys.current.add(event.key.toLowerCase());
      else keys.current.delete(event.key.toLowerCase());
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, [room?.id]);
  useFrame((_, delta) => {
    if (!room) return;
    const { yaw, pitch } = look.current;
    const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new Vector3(-forward.z, 0, forward.x);
    const k = keys.current;
    const roam = roamRef.current;
    const step = (roam ? (k.has("shift") ? 6 : 3) : 1.6) * delta;
    if (k.has("w") || k.has("arrowup")) camera.position.addScaledVector(forward, step);
    if (k.has("s") || k.has("arrowdown")) camera.position.addScaledVector(forward, -step);
    if (k.has("d") || k.has("arrowright")) camera.position.addScaledVector(right, step);
    if (k.has("a") || k.has("arrowleft")) camera.position.addScaledVector(right, -step);
    if (roam) {
      // Free flight: no walls, E / Space up, Q / C down.
      if (k.has("e") || k.has(" ")) camera.position.y += step;
      if (k.has("q") || k.has("c")) camera.position.y -= step;
    } else {
      const halfW = room.dimensions.width / 2 - 0.25;
      const halfD = room.dimensions.depth / 2 - 0.25;
      camera.position.x = Math.max(room.position.x - halfW, Math.min(room.position.x + halfW, camera.position.x));
      camera.position.z = Math.max(room.position.z - halfD, Math.min(room.position.z + halfD, camera.position.z));
      camera.position.y = room.position.y + 1.6;
    }
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  });
  return null;
}

/** Registers a capture function used by Screenshot and project thumbnails. */
function CaptureBridge() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    viewportBridge.capture = (type, maxWidth) => {
      gl.render(scene, camera);
      const source = gl.domElement;
      if (!maxWidth || source.width <= maxWidth) return source.toDataURL(type, 0.85);
      const canvas = document.createElement("canvas");
      canvas.width = maxWidth;
      canvas.height = Math.round((source.height / source.width) * maxWidth);
      canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL(type, 0.82);
    };
    return () => {
      viewportBridge.capture = null;
    };
  }, [gl, scene, camera]);
  return null;
}

function PerfProbe() {
  const { gl } = useThree();
  const frames = useRef(0);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    frames.current += 1;
    elapsed.current += delta;
    if (elapsed.current >= 0.5) {
      const info = gl.info;
      usePerfStore.setState({
        fps: frames.current / elapsed.current,
        frameMs: (elapsed.current / frames.current) * 1000,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
      });
      frames.current = 0;
      elapsed.current = 0;
    }
  });
  return null;
}

function DropBridge() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const raycaster = new Raycaster();
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    viewportBridge.screenToFloor = (clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(plane, new Vector3());
      return hit ? { x: hit.x, z: hit.z } : null;
    };
    return () => {
      viewportBridge.screenToFloor = null;
    };
  }, [camera, gl]);
  return null;
}

export function SceneViewport() {
  const scene = useWorkspaceStore((state) => state.scene);
  const selectedId = useWorkspaceStore((state) => state.selectedEntityId);
  const tool = useWorkspaceStore((state) => state.tool);
  const validation = useWorkspaceStore((state) => state.validation);
  const showRoutes = useWorkspaceStore((state) => state.showRoutes);
  const showPerf = useWorkspaceStore((state) => state.showPerf);
  const peers = useWorkspaceStore((state) => state.peers);
  const selfId = useWorkspaceStore((state) => state.selfId);
  const recovery = useWorkspaceStore((state) => state.recovery);
  const optimization = useWorkspaceStore((state) => state.optimization);
  const sun = useWorkspaceStore((state) => state.sun);
  const { selectEntity, dispatch } = useWorkspaceStore.getState();

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const dragBase = useRef<Record<string, number> | null>(null);
  const activeRoomId = useWorkspaceStore((state) => state.activeRoomId);
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const room = scene.rooms.find((entry) => entry.id === activeRoomId) ?? scene.rooms[0];
  // Floors above the active one are hidden (like switching storeys in a floor planner).
  const visibleRooms = useMemo(() => new Set(scene.rooms.filter((entry) => !room || entry.position.y <= room.position.y + 0.01).map((entry) => entry.id)), [scene.rooms, room]);
  const lowDetail = scene.furniture.length > LOW_DETAIL_THRESHOLD;
  // Plans read best flat: no sun shadows in 2D.
  const showGrid = useWorkspaceStore((state) => state.showGrid);
  const gridSize = useWorkspaceStore((state) => state.gridSize);
  const walkMode = useWorkspaceStore((state) => state.walkMode);
  const flatView = viewMode === "top" || viewMode === "front" || viewMode === "side";
  const shadows = scene.environment.shadows && !lowDetail && !flatView;
  const lightScale = scene.environment.artificialLightScale * ARTIFICIAL_LIGHT_FACTOR[scene.environment.mode];
  const selectedItem = scene.furniture.find((item) => item.id === selectedId);

  const severityById = useMemo(() => {
    const map = new Map<string, Severity>();
    for (const issue of validation?.issues ?? []) {
      if (issue.severity === "info") continue;
      for (const id of issue.highlight.objectIds) {
        if (map.get(id) !== "error") map.set(id, issue.severity);
      }
    }
    return map;
  }, [validation]);

  const zones = useMemo(() => {
    const issues: ValidationIssue[] = validation?.issues ?? [];
    const relevant = selectedId ? issues.filter((issue) => issue.objectIds.includes(selectedId)) : issues;
    return relevant.flatMap((issue) => issue.highlight.zones.map((zone) => ({ zone, color: issue.severity === "error" ? "#e5483d" : "#e6a23c" })));
  }, [validation, selectedId]);

  const peerSelections = useMemo(() => {
    const map = new Map<string, { color: string; name: string }>();
    for (const peer of peers) if (peer.clientId !== selfId && peer.selectedId) map.set(peer.selectedId, { color: peer.color, name: peer.name });
    return map;
  }, [peers, selfId]);

  // A rejected (conflicting) edit leaves the dragged group where it was dropped; restore canonical state.
  const conflict = useWorkspaceStore((state) => state.conflict);
  useEffect(() => {
    if (!conflict || !selectedGroup || !selectedItem) return;
    selectedGroup.position.set(selectedItem.position.x, selectedItem.position.y, selectedItem.position.z);
    selectedGroup.rotation.set(0, selectedItem.yawDegrees * DEG, 0);
  }, [conflict]);

  useEffect(() => {
    if (!lowDetail) preloadModels(new Set(scene.furniture.map((item) => item.catalogItemId ?? "")));
  }, [scene.furniture, lowDetail]);

  const previewCandidate = recovery.result?.candidates.find((candidate) => candidate.id === recovery.previewId) ?? null;
  const editingMesh = tool === "vertex" || tool === "face";

  const commitTransform = () => {
    if (!selectedGroup || !selectedItem) return;
    const { position, rotation, scale } = selectedGroup;
    let patch: FurniturePatch | null = null;
    if (tool === "translate") {
      const x = round(position.x);
      const z = round(position.z);
      if (Math.abs(x - selectedItem.position.x) > 1e-6 || Math.abs(z - selectedItem.position.z) > 1e-6) patch = { position: { x, z } };
    } else if (tool === "rotate") {
      const yaw = round((((rotation.y / DEG) % 360) + 360) % 360, 0.1);
      if (Math.abs(yaw - ((selectedItem.yawDegrees % 360) + 360) % 360) > 1e-6) patch = { yawDegrees: yaw };
    } else if (tool === "scale") {
      const { width, depth, height } = selectedItem.dimensions;
      const dimensions = {
        width: Math.max(0.02, round(width * Math.abs(scale.x))),
        height: Math.max(0.02, round(height * Math.abs(scale.y))),
        depth: Math.max(0.02, round(depth * Math.abs(scale.z))),
      };
      scale.set(1, 1, 1);
      if (dimensions.width !== width || dimensions.height !== height || dimensions.depth !== depth) patch = { dimensions };
    }
    if (patch) dispatch({ type: "furniture.update", furnitureId: selectedItem.id, patch }, { base: dragBase.current ?? undefined });
    else {
      // Nothing changed: snap the gizmo-moved group back to canonical state.
      selectedGroup.position.set(selectedItem.position.x, selectedItem.position.y, selectedItem.position.z);
      selectedGroup.rotation.set(0, selectedItem.yawDegrees * DEG, 0);
    }
    dragBase.current = null;
  };

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [7, 6.5, 8], fov: 40, near: 0.05, far: 600 }}
      gl={{ antialias: true }}
      onPointerMissed={(event) => {
        if (event.button === 0 && !editingMesh) selectEntity("");
      }}
    >
      <SceneEnvironment mode={scene.environment.mode} room={room ?? scene.rooms[0]!} shadows={shadows} plan={viewMode !== "perspective" && viewMode !== "walk"} />
      {room ? (
        <>
          <Grid
            visible={showGrid}
            args={[60, 60]}
            position={[room.position.x, room.position.y - 0.125, room.position.z]}
            cellSize={gridSize}
            cellThickness={0.5}
            cellColor={scene.environment.mode === "night" ? "#27344a" : "#b8c2bc"}
            sectionSize={gridSize * 4}
            sectionThickness={0.8}
            sectionColor={scene.environment.mode === "night" ? "#33445f" : "#94a39a"}
            fadeDistance={45}
            fadeStrength={1.4}
            infiniteGrid
          />
          {scene.rooms.filter((entry) => visibleRooms.has(entry.id)).map((entry) => (
            <RoomShell key={entry.id} room={entry} cutaway showDimensions={!lowDetail && entry.id === room.id} />
          ))}
        </>
      ) : null}
      {scene.furniture.map((item) => {
        // While its mesh is edited, the MeshEditor renders the object instead (and must receive the clicks).
        if (editingMesh && item.id === selectedId) return null;
        if (!visibleRooms.has(item.roomId)) return null;
        // Plan view: hide ceiling-mounted fixtures so they don't cover the floor plan.
        if (viewMode === "top" && item.position.y - (scene.rooms.find((entry) => entry.id === item.roomId)?.position.y ?? 0) > 1.9) return null;
        const peer = peerSelections.get(item.id);
        return (
          <FurnitureItem
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            severity={severityById.get(item.id) ?? null}
            peerColor={peer?.color ?? null}
            peerName={peer?.name ?? null}
            lowDetail={lowDetail}
            shadows={shadows}
            lightScale={lightScale}
            groupRef={item.id === selectedId ? setSelectedGroup : undefined}
            onSelect={selectEntity}
            draggable={(tool === "select" || tool === "translate" || tool === "rotate") && !(viewMode === "walk" && walkMode === "view")}
          />
        );
      })}
      {zones.map((entry, index) => <FloorZone key={index} polygon={entry.zone} color={entry.color} />)}
      {showRoutes ? validation?.routes.map((route) => (
        <Line key={route.targetId} points={route.points.map(([x, z]) => [x, 0.03, z] as [number, number, number])} color="#3b82d9" lineWidth={2} transparent opacity={0.8} />
      )) : null}
      {previewCandidate ? <RecoveryPreview moves={previewCandidate.moves} scene={scene} /> : null}
      {optimization.preview && optimization.result ? (
        <RecoveryPreview scene={scene} moves={optimization.result.moves.map((move) => ({ objectId: move.objectId, from: { x: move.from[0], z: move.from[1] }, to: { x: move.to[0], z: move.to[1], yawDegrees: move.yawTo } }))} />
      ) : null}
      {sun.overlay && sun.result && room ? <SunOverlay study={sun.result} room={room} /> : null}
      {selectedItem && selectedGroup && !editingMesh && tool !== "scale" ? <SelectionHandles key={selectedItem.id + ":" + selectedItem.version} item={selectedItem} group={selectedGroup} /> : null}
      {selectedItem && selectedGroup && !editingMesh && (tool === "translate" || tool === "rotate" || tool === "scale") && !selectedItem.constraints?.locked ? (
        <TransformControls
          object={selectedGroup as Object3D}
          mode={tool as Exclude<TransformTool, "select" | "vertex" | "face">}
          showX={tool !== "rotate"}
          showY={tool !== "translate"}
          showZ={tool !== "rotate"}
          translationSnap={0.05}
          rotationSnap={Math.PI / 24}
          scaleSnap={0.05}
          size={0.75}
          onMouseDown={() => {
            dragBase.current = { [selectedItem.id]: selectedItem.version };
          }}
          onMouseUp={commitTransform}
        />
      ) : null}
      {selectedItem && editingMesh ? <MeshEditor item={selectedItem} mode={tool} /> : null}
      <CameraRig scene={scene} selectedId={selectedId} room={room} />
      <DragController />
      <CaptureBridge />
      {viewMode !== "walk" ? (
        <GizmoHelper alignment="bottom-left" margin={[64, 64]}>
          <GizmoViewport axisColors={["#e5483d", "#3fae5a", "#3b82d9"]} labelColor="#fff" />
        </GizmoHelper>
      ) : null}
      <PlacementController />
      <PresenceCursors />
      <PlacementGhost />
      <DropBridge />
      <PerfProbe />
    </Canvas>
  );
}
