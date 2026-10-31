import { memo, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Vector3, type Mesh, type Object3D } from "three";
import type { FurnitureObject } from "@reality-builder/shared";
import manifest from "../../data/model-manifest.json";

type ManifestEntry = { asset: string; file: string; yaw?: number };
const MODELS = manifest as Record<string, ManifestEntry>;

/** Per-asset correction so the model's front faces local +Z (the editor convention). */
const YAW_FIX: Record<string, number> = { modern_coffee_table_01: 90, desk_lamp_arm_01: 90 };

/** Switched off on request: procedural models are used everywhere. Flip to re-enable the Poly Haven models. */
export const USE_REALISTIC_MODELS = false;

export function hasRealisticModel(item: FurnitureObject) {
  return USE_REALISTIC_MODELS && !item.mesh && !!item.catalogItemId && item.catalogItemId in MODELS;
}

export function modelUrl(catalogItemId: string) {
  const entry = MODELS[catalogItemId];
  return entry ? "/" + entry.file : null;
}

/**
 * Photoreal CC0 model (Poly Haven) fitted exactly into the object's bounding box, so the visual always
 * matches the collider the spatial engine checks. Must be rendered inside <Suspense>.
 */
export const RealisticModel = memo(function RealisticModel({ item, castShadow }: { item: FurnitureObject; castShadow: boolean }) {
  const entry = MODELS[item.catalogItemId ?? ""]!;
  const gltf = useGLTF("/" + entry.file);
  const { width, depth, height } = item.dimensions;
  const yawFix = YAW_FIX[entry.asset] ?? 0;

  const fitted = useMemo(() => {
    const clone: Object3D = gltf.scene.clone(true);
    clone.rotation.y = (yawFix * Math.PI) / 180;
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
  }, [gltf, yawFix, castShadow]);

  const sx = width / fitted.size.x;
  const sy = height / fitted.size.y;
  const sz = depth / fitted.size.z;
  return (
    <group scale={[sx, sy, sz]}>
      <group position={[-fitted.center.x, -fitted.center.y + fitted.size.y / 2, -fitted.center.z]}>
        <primitive object={fitted.clone} />
      </group>
    </group>
  );
});

/** Warm the cache for models used by the current scene. */
export function preloadModels(catalogItemIds: Iterable<string>) {
  if (!USE_REALISTIC_MODELS) return;
  for (const id of catalogItemIds) {
    const url = modelUrl(id);
    if (url) useGLTF.preload(url);
  }
}
