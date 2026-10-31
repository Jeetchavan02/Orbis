import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, Grid, Html, Line, OrbitControls, TransformControls } from "@react-three/drei";
import { Plane, Raycaster, Shape, Vector2, Vector3, type Group, type Object3D } from "three";
import type { FurnitureObject, FurniturePatch, Scene, ValidationIssue } from "@reality-builder/shared";
import type { RecoveryCandidate } from "@reality-builder/spatial-engine";
import { useWorkspaceStore, type TransformTool } from "../store/workspace";
import { usePerfStore, viewportBridge } from "../lib/perf";
import { useContextMenu } from "../lib/ui";
import { FurnitureModel } from "./viewport/FurnitureModel";
import { RoomShell } from "./viewport/Room";
import { ARTIFICIAL_LIGHT_FACTOR, SceneEnvironment } from "./viewport/Environment";
import { MeshEditor } from "./viewport/MeshEditor";

const DEG = Math.PI / 180;
const LOW_DETAIL_THRESHOLD = 150;
const round = (value: number, step = 0.001) => Math.round(value / step) * step;

type Severity = "error" | "warning";

const FurnitureItem = memo(function FurnitureItem({
  item, selected, severity, peerColor, peerName, lowDetail, shadows, lightScale, groupRef, onSelect,
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
}) {
  const { width, depth, height } = item.dimensions;
  const light = item.light;
  const lightOn = !!light?.on && lightScale > 0;
  const outline = selected ? "#1f7a5c" : severity === "error" ? "#d9443a" : severity === "warning" ? "#d9921f" : peerColor;
  return (
    <group
      ref={groupRef}
      position={[item.position.x, item.position.y, item.position.z]}
      rotation={[0, item.yawDegrees * DEG, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item.id);
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
        event.nativeEvent.preventDefault();
        onSelect(item.id);
        useContextMenu.getState().open(event.nativeEvent.clientX, event.nativeEvent.clientY, item.id);
      }}
    >
      <FurnitureModel item={item} lowDetail={lowDetail} castShadow={shadows && !lowDetail} lightOn={lightOn} />
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

function RecoveryPreview({ candidate, scene }: { candidate: RecoveryCandidate; scene: Scene }) {
  return (
    <group>
      {candidate.moves.map((move) => {
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

function CameraRig({ scene, selectedId }: { scene: Scene; selectedId: string }) {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const resetSignal = useWorkspaceStore((state) => state.resetCameraSignal);
  const focusSignal = useWorkspaceStore((state) => state.focusSignal);
  const { camera } = useThree();
  const room = scene.rooms[0];
  const span = room ? Math.max(room.dimensions.width, room.dimensions.depth) : 6;

  const frame = (center: Vector3, radius: number) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const direction = new Vector3(0.62, 0.78, 0.92).normalize();
    camera.position.copy(center).addScaledVector(direction, Math.max(2.2, radius * 2.3));
    controls.target.copy(center);
    controls.update();
  };

  useEffect(() => {
    if (room) frame(new Vector3(room.position.x, 0.6, room.position.z), span * 0.75);
    // Re-frame only when the room itself changes size or a reset is requested.
  }, [resetSignal, room?.id, span]);

  useEffect(() => {
    if (focusSignal === 0) return;
    const item = scene.furniture.find((entry) => entry.id === selectedId);
    if (item) frame(new Vector3(item.position.x, item.position.y + item.dimensions.height / 2, item.position.z), Math.max(item.dimensions.width, item.dimensions.depth, item.dimensions.height));
  }, [focusSignal]);

  return <OrbitControls ref={controlsRef} makeDefault minDistance={1} maxDistance={span * 4 + 20} maxPolarAngle={Math.PI * 0.495} enableDamping dampingFactor={0.1} />;
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
  const { selectEntity, dispatch } = useWorkspaceStore.getState();

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const dragBase = useRef<Record<string, number> | null>(null);
  const room = scene.rooms[0];
  const lowDetail = scene.furniture.length > LOW_DETAIL_THRESHOLD;
  const shadows = scene.environment.shadows && !lowDetail;
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
      <SceneEnvironment mode={scene.environment.mode} room={room ?? scene.rooms[0]!} shadows={shadows} />
      {room ? (
        <>
          <Grid
            args={[60, 60]}
            position={[room.position.x, -0.125, room.position.z]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor={scene.environment.mode === "night" ? "#27344a" : "#b8c2bc"}
            sectionSize={2}
            sectionThickness={0.8}
            sectionColor={scene.environment.mode === "night" ? "#33445f" : "#94a39a"}
            fadeDistance={45}
            fadeStrength={1.4}
            infiniteGrid
          />
          {scene.rooms.map((entry) => (
            <RoomShell key={entry.id} room={entry} cutaway showDimensions={!lowDetail} />
          ))}
        </>
      ) : null}
      {scene.furniture.map((item) => {
        // While its mesh is edited, the MeshEditor renders the object instead (and must receive the clicks).
        if (editingMesh && item.id === selectedId) return null;
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
          />
        );
      })}
      {zones.map((entry, index) => <FloorZone key={index} polygon={entry.zone} color={entry.color} />)}
      {showRoutes ? validation?.routes.map((route) => (
        <Line key={route.targetId} points={route.points.map(([x, z]) => [x, 0.03, z] as [number, number, number])} color="#3b82d9" lineWidth={2} transparent opacity={0.8} />
      )) : null}
      {previewCandidate ? <RecoveryPreview candidate={previewCandidate} scene={scene} /> : null}
      {selectedItem && selectedGroup && !editingMesh && tool !== "select" && !selectedItem.constraints?.locked ? (
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
      <CameraRig scene={scene} selectedId={selectedId} />
      <DropBridge />
      {showPerf ? <PerfProbe /> : null}
    </Canvas>
  );
}
