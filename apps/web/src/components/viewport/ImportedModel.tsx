import { Component, memo, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Vector3, type Mesh, type Object3D } from "three";
import type { FurnitureObject, MeshData } from "@reality-builder/shared";

/**
 * Imported .glb models keep their own materials and textures. The file lives in the asset store and the object
 * keeps the baked triangle mesh for collisions and mesh editing. catalogItemId = "glb:<file>|<signature>", where
 * the signature fingerprints the imported mesh: once the mesh is edited (vertex move, extrude) the textured model
 * no longer matches, so the editable mesh is drawn instead. Undo restores the textured look.
 */
export const GLB_PREFIX = "glb:";

export function meshSignature(mesh: Pick<MeshData, "positions" | "indices">) {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(mesh.positions.length / 4096));
  for (let i = 0; i < mesh.positions.length; i += step) hash = Math.imul(hash ^ Math.round(mesh.positions[i]! * 1000), 16777619);
  return `${mesh.positions.length}-${mesh.indices.length}-${(hash >>> 0).toString(36)}`;
}

export function importedModelUrl(item: FurnitureObject): string | null {
  const id = item.catalogItemId;
  if (!id?.startsWith(GLB_PREFIX) || !item.mesh) return null;
  const [file, signature] = id.slice(GLB_PREFIX.length).split("|");
  if (!file || !/^model-[a-z0-9-]+\.glb$/.test(file) || signature !== meshSignature(item.mesh)) return null;
  return "/api/assets/" + file;
}

/** If the model file can't load (deleted, offline), fall back to the plain mesh instead of breaking the scene. */
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const ImportedModel = memo(function ImportedModel({ item, url, castShadow }: { item: FurnitureObject; url: string; castShadow: boolean }) {
  const gltf = useGLTF(url);
  const { width, depth, height } = item.dimensions;
  const fitted = useMemo(() => {
    const clone: Object3D = gltf.scene.clone(true);
    clone.updateMatrixWorld(true);
    const box = new Box3().setFromObject(clone);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    clone.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
      }
    });
    return { clone, size, center };
  }, [gltf, castShadow]);
  // Fitted to the object's bounding box, which the import derived from the same geometry, so visual = collider.
  return (
    <group scale={[width / Math.max(fitted.size.x, 1e-6), height / Math.max(fitted.size.y, 1e-6), depth / Math.max(fitted.size.z, 1e-6)]}>
      <group position={[-fitted.center.x, -fitted.center.y + fitted.size.y / 2, -fitted.center.z]}>
        <primitive object={fitted.clone} />
      </group>
    </group>
  );
});
