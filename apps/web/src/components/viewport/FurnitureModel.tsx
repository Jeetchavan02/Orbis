import { memo, useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color } from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { Mesh } from "three";
import type { FurnitureObject, MeshData } from "@reality-builder/shared";

// BVH-accelerated raycasting for (potentially large) imported/edited meshes.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

type Vec3 = [number, number, number];

function shade(hex: string, amount: number) {
  const color = new Color(hex);
  if (amount < 0) color.lerp(new Color("#000000"), -amount);
  else color.lerp(new Color("#ffffff"), amount);
  return "#" + color.getHexString();
}

/** Box positioned by its min corner offset from the object's bottom-center (local meters). */
function Block({ size, at, color, roughness = 0.8, metalness = 0, emissive, emissiveIntensity = 0, castShadow }: {
  size: Vec3; at: Vec3; color: string; roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; castShadow: boolean;
}) {
  return (
    <mesh position={[at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + size[2] / 2]} castShadow={castShadow} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} emissive={emissive ?? "#000000"} emissiveIntensity={emissiveIntensity} />
    </mesh>
  );
}

function Cylinder({ radiusTop, radiusBottom, height, at, color, segments = 24, emissive, emissiveIntensity = 0, castShadow, roughness = 0.7 }: {
  radiusTop: number; radiusBottom: number; height: number; at: Vec3; color: string; segments?: number; emissive?: string; emissiveIntensity?: number; castShadow: boolean; roughness?: number;
}) {
  return (
    <mesh position={[at[0], at[1] + height / 2, at[2]]} castShadow={castShadow} receiveShadow>
      <cylinderGeometry args={[radiusTop, radiusBottom, height, segments]} />
      <meshStandardMaterial color={color} roughness={roughness} emissive={emissive ?? "#000000"} emissiveIntensity={emissiveIntensity} />
    </mesh>
  );
}

/** Flat-shaded geometry built from canonical mesh data (local space). */
export function useMeshGeometry(mesh: MeshData | undefined) {
  return useMemo(() => {
    if (!mesh) return null;
    const indexed = new BufferGeometry();
    indexed.setAttribute("position", new BufferAttribute(new Float32Array(mesh.positions), 3));
    indexed.setIndex(mesh.indices);
    const flat = indexed.toNonIndexed();
    indexed.dispose();
    flat.computeVertexNormals();
    flat.computeBoundingBox();
    flat.computeBoundingSphere();
    if (mesh.indices.length / 3 > 500) flat.computeBoundsTree();
    return flat;
  }, [mesh]);
}

type ModelProps = { item: FurnitureObject; lowDetail: boolean; castShadow: boolean; lightOn: boolean };

/**
 * Procedural furniture models. Every part stays inside the object's bounding box, so what users see
 * matches the collider the spatial engine checks.
 */
export const FurnitureModel = memo(function FurnitureModel({ item, lowDetail, castShadow, lightOn }: ModelProps) {
  const meshGeometry = useMeshGeometry(item.mesh);
  const { width: w, depth: d, height: h } = item.dimensions;
  const base = item.color ?? "#9aa39e";
  const x0 = -w / 2;
  const z0 = -d / 2;

  if (meshGeometry) {
    return (
      <mesh geometry={meshGeometry} castShadow={castShadow} receiveShadow userData={{ editableMesh: true }}>
        <meshStandardMaterial color={base} roughness={0.65} flatShading />
      </mesh>
    );
  }
  if (lowDetail) return <Block size={[w, h, d]} at={[x0, 0, z0]} color={base} castShadow={false} />;

  const s = castShadow;
  const wood = shade(base, -0.12);
  const glow = lightOn ? "#ffd59a" : undefined;
  switch (item.catalogItemId) {
    case "bed-queen":
    case "bed-single": {
      const frameH = Math.min(0.32, h * 0.32);
      const mattressH = Math.min(0.24, h * 0.24);
      const head = Math.min(0.08, d * 0.05);
      const pillowW = Math.min(0.62, (w - 0.2) / 2);
      return (
        <group>
          <Block size={[w, frameH, d - head]} at={[x0, 0, z0 + head]} color="#8f735b" castShadow={s} />
          <Block size={[w - 0.06, mattressH, d - head - 0.06]} at={[x0 + 0.03, frameH, z0 + head + 0.03]} color="#f4f2ee" roughness={0.95} castShadow={s} />
          <Block size={[w - 0.02, 0.05, (d - head) * 0.62]} at={[x0 + 0.01, frameH + mattressH, z0 + head + (d - head) * 0.37]} color={base} roughness={0.95} castShadow={s} />
          <Block size={[w, h, head]} at={[x0, 0, z0]} color={shade("#8f735b", -0.15)} castShadow={s} />
          {w > 1.2 ? (
            <>
              <Block size={[pillowW, 0.12, 0.38]} at={[-pillowW - 0.04, frameH + mattressH, z0 + head + 0.08]} color="#ffffff" roughness={1} castShadow={s} />
              <Block size={[pillowW, 0.12, 0.38]} at={[0.04, frameH + mattressH, z0 + head + 0.08]} color="#ffffff" roughness={1} castShadow={s} />
            </>
          ) : (
            <Block size={[Math.min(0.6, w - 0.2), 0.12, 0.36]} at={[-Math.min(0.6, w - 0.2) / 2, frameH + mattressH, z0 + head + 0.08]} color="#ffffff" roughness={1} castShadow={s} />
          )}
        </group>
      );
    }
    case "nightstand":
    case "dresser": {
      const legs = 0.08;
      const drawers = item.catalogItemId === "dresser" ? 3 : 2;
      const bodyH = h - legs;
      return (
        <group>
          {[[x0 + 0.03, z0 + 0.03], [-x0 - 0.06, z0 + 0.03], [x0 + 0.03, -z0 - 0.06], [-x0 - 0.06, -z0 - 0.06]].map(([lx, lz], index) => (
            <Block key={index} size={[0.03, legs, 0.03]} at={[lx!, 0, lz!]} color={shade(base, -0.3)} castShadow={false} />
          ))}
          <Block size={[w, bodyH, d - 0.02]} at={[x0, legs, z0]} color={base} castShadow={s} />
          {Array.from({ length: drawers }, (_, index) => {
            const drawerH = (bodyH - 0.04) / drawers;
            return (
              <group key={index}>
                <Block size={[w - 0.04, drawerH - 0.02, 0.02]} at={[x0 + 0.02, legs + 0.02 + index * drawerH, -z0 - 0.02]} color={shade(base, 0.08)} castShadow={false} />
                <Block size={[Math.min(0.16, w * 0.3), 0.015, 0.02]} at={[-Math.min(0.08, w * 0.15), legs + 0.02 + index * drawerH + drawerH / 2, -z0]} color="#cfc8bb" metalness={0.6} roughness={0.3} castShadow={false} />
              </group>
            );
          })}
        </group>
      );
    }
    case "wardrobe":
    case "bookshelf": {
      if (item.catalogItemId === "bookshelf") {
        const shelves = Math.max(2, Math.round(h / 0.36));
        const bookColors = ["#7c5a46", "#4e6a77", "#b99a5b", "#7f8f6a", "#9a5a5a"];
        return (
          <group>
            <Block size={[0.025, h, d]} at={[x0, 0, z0]} color={base} castShadow={s} />
            <Block size={[0.025, h, d]} at={[-x0 - 0.025, 0, z0]} color={base} castShadow={s} />
            <Block size={[w, h, 0.015]} at={[x0, 0, z0]} color={shade(base, -0.2)} castShadow={s} />
            {Array.from({ length: shelves + 1 }, (_, index) => (
              <Block key={index} size={[w - 0.05, 0.022, d - 0.015]} at={[x0 + 0.025, index * ((h - 0.022) / shelves), z0 + 0.015]} color={base} castShadow={false} />
            ))}
            {Array.from({ length: shelves }, (_, row) =>
              Array.from({ length: 5 }, (_, book) => (
                <Block key={row + "-" + book} size={[0.05, 0.22 + ((row + book) % 3) * 0.03, d * 0.7]}
                  at={[x0 + 0.06 + book * 0.075 + (row % 2) * 0.12, row * ((h - 0.022) / shelves) + 0.022, z0 + 0.03]}
                  color={bookColors[(row * 2 + book) % bookColors.length]!} castShadow={false} />
              )),
            )}
          </group>
        );
      }
      return (
        <group>
          <Block size={[w, h, d - 0.02]} at={[x0, 0, z0]} color={base} castShadow={s} />
          <Block size={[w / 2 - 0.015, h - 0.06, 0.02]} at={[x0 + 0.01, 0.04, -z0 - 0.02]} color={shade(base, 0.06)} castShadow={false} />
          <Block size={[w / 2 - 0.015, h - 0.06, 0.02]} at={[0.005, 0.04, -z0 - 0.02]} color={shade(base, 0.06)} castShadow={false} />
          <Block size={[0.015, 0.3, 0.025]} at={[-0.035, h * 0.45, -z0]} color="#d9d3c7" metalness={0.7} roughness={0.25} castShadow={false} />
          <Block size={[0.015, 0.3, 0.025]} at={[0.02, h * 0.45, -z0]} color="#d9d3c7" metalness={0.7} roughness={0.25} castShadow={false} />
        </group>
      );
    }
    case "desk":
    case "coffee-table": {
      const top = item.catalogItemId === "desk" ? 0.035 : 0.05;
      const leg = 0.045;
      return (
        <group>
          <Block size={[w, top, d]} at={[x0, h - top, z0]} color={base} roughness={0.55} castShadow={s} />
          {[[x0 + 0.04, z0 + 0.04], [-x0 - 0.04 - leg, z0 + 0.04], [x0 + 0.04, -z0 - 0.04 - leg], [-x0 - 0.04 - leg, -z0 - 0.04 - leg]].map(([lx, lz], index) => (
            <Block key={index} size={[leg, h - top, leg]} at={[lx!, 0, lz!]} color={wood} castShadow={s} />
          ))}
          {item.catalogItemId === "desk" ? <Block size={[w * 0.4, 0.12, d - 0.1]} at={[-x0 - 0.06 - w * 0.4, h - top - 0.12, z0 + 0.05]} color={shade(base, 0.05)} castShadow={false} /> : null}
        </group>
      );
    }
    case "desk-chair": {
      const seat = Math.min(0.47, h * 0.52);
      return (
        <group>
          <Cylinder radiusTop={w * 0.36} radiusBottom={w * 0.42} height={0.04} at={[0, 0, 0]} color="#3b403e" castShadow={false} />
          <Cylinder radiusTop={0.025} radiusBottom={0.025} height={seat - 0.1} at={[0, 0.04, 0]} color="#7d8380" castShadow={s} />
          <Block size={[w, 0.07, d * 0.9]} at={[x0, seat - 0.07, z0 + d * 0.1]} color={base} castShadow={s} />
          <Block size={[w * 0.92, h - seat - 0.02, 0.06]} at={[-w * 0.46, seat, z0]} color={base} castShadow={s} />
        </group>
      );
    }
    case "armchair":
    case "sofa": {
      const seat = h * 0.5;
      const arm = Math.min(0.16, w * 0.15);
      const back = Math.min(0.2, d * 0.25);
      return (
        <group>
          <Block size={[w, seat * 0.55, d]} at={[x0, 0.06, z0]} color={shade(base, -0.1)} castShadow={s} />
          <Block size={[w - arm * 2, seat * 0.45, d - back]} at={[x0 + arm, seat * 0.6, z0 + back]} color={shade(base, 0.08)} roughness={0.95} castShadow={s} />
          <Block size={[w, h - 0.06, back]} at={[x0, 0.06, z0]} color={base} roughness={0.95} castShadow={s} />
          <Block size={[arm, h * 0.68, d]} at={[x0, 0.06, z0]} color={base} castShadow={s} />
          <Block size={[arm, h * 0.68, d]} at={[-x0 - arm, 0.06, z0]} color={base} castShadow={s} />
          {[[x0 + 0.04, z0 + 0.04], [-x0 - 0.08, z0 + 0.04], [x0 + 0.04, -z0 - 0.08], [-x0 - 0.08, -z0 - 0.08]].map(([lx, lz], index) => (
            <Block key={index} size={[0.04, 0.06, 0.04]} at={[lx!, 0, lz!]} color="#3a2f27" castShadow={false} />
          ))}
        </group>
      );
    }
    case "floor-lamp": {
      const shadeH = Math.min(0.32, h * 0.22);
      return (
        <group>
          <Cylinder radiusTop={w * 0.4} radiusBottom={w * 0.45} height={0.03} at={[0, 0, 0]} color="#2f3532" castShadow={s} />
          <Cylinder radiusTop={0.012} radiusBottom={0.012} height={h - shadeH} at={[0, 0.03, 0]} color="#3e4441" castShadow={s} />
          <Cylinder radiusTop={w * 0.32} radiusBottom={w * 0.5} height={shadeH} at={[0, h - shadeH, 0]} color={base} emissive={glow} emissiveIntensity={lightOn ? 0.9 : 0} castShadow={false} roughness={0.9} />
        </group>
      );
    }
    case "desk-lamp":
      return (
        <group>
          <Cylinder radiusTop={w * 0.4} radiusBottom={w * 0.45} height={0.02} at={[0, 0, 0]} color={base} castShadow={s} />
          <Cylinder radiusTop={0.008} radiusBottom={0.008} height={h * 0.75} at={[0, 0.02, 0]} color={base} castShadow={s} />
          <Cylinder radiusTop={w * 0.2} radiusBottom={w * 0.48} height={h * 0.25} at={[0, h * 0.75, 0]} color={base} emissive={glow} emissiveIntensity={lightOn ? 0.5 : 0} castShadow={false} />
        </group>
      );
    case "ceiling-light":
      return (
        <group>
          <Cylinder radiusTop={w * 0.12} radiusBottom={w * 0.12} height={h * 0.4} at={[0, h * 0.6, 0]} color="#d6d2ca" castShadow={false} />
          <Cylinder radiusTop={w * 0.5} radiusBottom={w * 0.42} height={h * 0.6} at={[0, 0, 0]} color={base} emissive={lightOn ? "#fff1dc" : undefined} emissiveIntensity={lightOn ? 1.2 : 0} castShadow={false} segments={40} />
        </group>
      );
    case "plant": {
      const pot = Math.min(0.32, h * 0.3);
      return (
        <group>
          <Cylinder radiusTop={w * 0.36} radiusBottom={w * 0.28} height={pot} at={[0, 0, 0]} color="#c9b8a3" castShadow={s} />
          {[[0, h * 0.58, 0, w * 0.34], [w * 0.12, h * 0.78, -w * 0.06, w * 0.26], [-w * 0.1, h * 0.72, w * 0.1, w * 0.24], [0, h - w * 0.2, 0, w * 0.2]].map(([px, py, pz, r], index) => (
            <mesh key={index} position={[px!, Math.min(py!, h - r!), pz!]} castShadow={s}>
              <icosahedronGeometry args={[r!, 1]} />
              <meshStandardMaterial color={shade(base, index % 2 ? -0.12 : 0.04)} roughness={0.9} flatShading />
            </mesh>
          ))}
          <Cylinder radiusTop={0.012} radiusBottom={0.016} height={h * 0.45} at={[0, pot, 0]} color="#5b4a39" castShadow={false} />
        </group>
      );
    }
    case "rug":
      return (
        <group>
          <Block size={[w, h, d]} at={[x0, 0, z0]} color={base} roughness={1} castShadow={false} />
          <Block size={[w - 0.16, h + 0.001, d - 0.16]} at={[x0 + 0.08, 0, z0 + 0.08]} color={shade(base, -0.08)} roughness={1} castShadow={false} />
        </group>
      );
    default:
      return <Block size={[w, h, d]} at={[x0, 0, z0]} color={base} castShadow={s} />;
  }
});
