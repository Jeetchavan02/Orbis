import { useLoader } from "@react-three/fiber";
import { DoubleSide, SRGBColorSpace, TextureLoader } from "three";
import type { FurnitureObject } from "@reality-builder/shared";
import { CUTOUT_PREFIX } from "../panels/PhotoTo3D";

const SLICES = 7;

export function isCutout(item: FurnitureObject) {
  return !!item.catalogItemId?.startsWith(CUTOUT_PREFIX);
}

/**
 * A photo cutout standing in the room: the transparent PNG on stacked slices a few centimetres deep,
 * so it reads as a solid object at an angle and casts a silhouette shadow (alphaTest drives the shadow map).
 */
export function CutoutModel({ item, castShadow }: { item: FurnitureObject; castShadow: boolean }) {
  const id = item.catalogItemId!.slice(CUTOUT_PREFIX.length);
  const texture = useLoader(TextureLoader, `/api/assets/${id}.png`);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  const { width, height, depth } = item.dimensions;
  const thickness = Math.min(depth, 0.06);
  return (
    <group>
      {Array.from({ length: SLICES }, (_, index) => {
        const z = -thickness / 2 + (thickness * index) / (SLICES - 1);
        const edge = index !== 0 && index !== SLICES - 1;
        return (
          <mesh key={index} position={[0, height / 2, z]} castShadow={castShadow && index === 0} receiveShadow={!edge}>
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial map={texture} transparent alphaTest={0.5} side={DoubleSide} roughness={0.75} color={edge ? "#b9b2a8" : "#ffffff"} />
          </mesh>
        );
      })}
    </group>
  );
}
