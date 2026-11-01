import { useMemo, useState } from "react";
import { TransformControls } from "@react-three/drei";
import { BufferAttribute, BufferGeometry, type Object3D } from "three";
import {
  faceTriangles,
  moveVertices,
  normalizeMesh,
  uniqueVertexIndices,
  type FurnitureObject,
  type MeshData,
} from "@reality-builder/shared";
import { rotateYaw } from "@reality-builder/spatial-engine";
import { useWorkspaceStore } from "../../store/workspace";
import { useMeshGeometry } from "./FurnitureModel";

const DEG = Math.PI / 180;

/**
 * Commits an edited local mesh: re-anchors it bottom-center, shifts the object so the geometry stays put
 * in the world, and dispatches one undoable action (bounds and colliders are derived from the new mesh).
 */
export function commitMesh(item: FurnitureObject, mesh: MeshData, label: string) {
  const normalized = normalizeMesh(mesh);
  const [ox, oy, oz] = normalized.offset;
  const [wx, wz] = rotateYaw([ox, oz], item.yawDegrees);
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  return useWorkspaceStore.getState().dispatch(
    {
      type: "furniture.update",
      furnitureId: item.id,
      patch: {
        mesh: { ...normalized.mesh, positions: normalized.mesh.positions.map(round) },
        position: { x: round(item.position.x + wx), y: round(item.position.y + oy), z: round(item.position.z + wz) },
      },
    },
    { base: { [item.id]: item.version }, label },
  );
}

export function MeshEditor({ item, mode }: { item: FurnitureObject; mode: "vertex" | "face" }) {
  const mesh = item.mesh;
  const geometry = useMeshGeometry(mesh);
  const selection = useWorkspaceStore((state) => state.mesh);
  const setMeshSelection = useWorkspaceStore((state) => state.setMeshSelection);
  const [handle, setHandle] = useState<Object3D | null>(null);
  const vertices = useMemo(() => (mesh ? uniqueVertexIndices(mesh) : []), [mesh]);

  const faceGeometry = useMemo(() => {
    if (!mesh || !selection.face) return null;
    const positions: number[] = [];
    for (const triangle of selection.face) {
      for (let corner = 0; corner < 3; corner += 1) {
        const index = mesh.indices[triangle * 3 + corner]!;
        positions.push(mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!);
      }
    }
    const result = new BufferGeometry();
    result.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    return result;
  }, [mesh, selection.face]);

  if (!mesh || !geometry) return null;
  const vertex = selection.vertex;
  const chosen = selection.vertices.filter((index) => index * 3 < mesh.positions.length);
  const chosenSet = new Set(chosen);
  // The gizmo sits at the centroid of the selected vertices and moves them all together.
  const vertexPosition: [number, number, number] | null = chosen.length === 0
    ? null
    : [0, 1, 2].map((axis) => chosen.reduce((sum, index) => sum + mesh.positions[index * 3 + axis]!, 0) / chosen.length) as [number, number, number];
  const radius = Math.max(0.012, Math.min(0.03, Math.max(item.dimensions.width, item.dimensions.depth) * 0.02));

  return (
    <group position={[item.position.x, item.position.y, item.position.z]} rotation={[0, item.yawDegrees * DEG, 0]}>
      <mesh
        geometry={geometry}
        onClick={(event) => {
          event.stopPropagation();
          // Non-indexed geometry: faceIndex equals the source triangle index.
          if (mode === "face" && event.faceIndex != null) setMeshSelection({ face: faceTriangles(mesh, event.faceIndex), vertex: null, vertices: [] });
        }}
      >
        <meshStandardMaterial color={item.color ?? "#9aa39e"} roughness={0.7} flatShading transparent opacity={0.92} />
      </mesh>
      <mesh geometry={geometry} raycast={() => null}>
        <meshBasicMaterial color="#1f2a26" wireframe transparent opacity={0.35} />
      </mesh>
      {faceGeometry ? (
        <mesh geometry={faceGeometry} raycast={() => null} renderOrder={2}>
          <meshBasicMaterial color="#2f9e6e" transparent opacity={0.6} depthTest={false} side={2} />
        </mesh>
      ) : null}
      {mode === "vertex"
        ? vertices.map((index) => (
            <mesh
              key={index}
              position={[mesh.positions[index * 3]!, mesh.positions[index * 3 + 1]!, mesh.positions[index * 3 + 2]!]}
              onClick={(event) => {
                event.stopPropagation();
                const additive = event.shiftKey || event.metaKey || event.ctrlKey;
                if (!additive) return setMeshSelection({ vertex: index, vertices: [index], face: null });
                const next = chosenSet.has(index) ? chosen.filter((entry) => entry !== index) : [...chosen, index];
                setMeshSelection({ vertex: next.length ? next[next.length - 1]! : null, vertices: next, face: null });
              }}
              renderOrder={3}
            >
              <sphereGeometry args={[chosenSet.has(index) ? radius * 1.5 : radius, 10, 10]} />
              <meshBasicMaterial color={chosenSet.has(index) ? "#6a3de8" : "#ffffff"} depthTest={false} />
            </mesh>
          ))
        : null}
      {mode === "vertex" && vertexPosition ? (
        <>
          <object3D ref={setHandle} position={vertexPosition} key={chosen.join("-") + ":" + vertexPosition.join(",")} />
          {handle ? (
            <TransformControls
              object={handle}
              mode="translate"
              size={0.6}
              translationSnap={0.01}
              onMouseUp={() => {
                if (chosen.length === 0) return;
                const delta: [number, number, number] = [handle.position.x - vertexPosition[0], handle.position.y - vertexPosition[1], handle.position.z - vertexPosition[2]];
                if (Math.hypot(...delta) < 1e-5) return;
                commitMesh(item, moveVertices(mesh, chosen, delta), chosen.length === 1 ? "Move vertex" : `Move ${chosen.length} vertices`);
              }}
            />
          ) : null}
        </>
      ) : null}
    </group>
  );
}

