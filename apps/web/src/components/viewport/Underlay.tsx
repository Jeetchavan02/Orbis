import { useEffect, useState } from "react";
import { DoubleSide, SRGBColorSpace, TextureLoader, type Texture } from "three";
import type { Room, Underlay } from "@reality-builder/shared";

/** The floor-plan reference image, laid just above the floor of its room and under the furniture. */
export function UnderlayPlane({ underlay, rooms }: { underlay: Underlay; rooms: Room[] }) {
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let live = true;
    let loaded: Texture | null = null;
    new TextureLoader().load(underlay.url, (result) => {
      if (!live) return result.dispose();
      result.colorSpace = SRGBColorSpace;
      result.anisotropy = 8;
      loaded = result;
      setTexture(result);
    }, undefined, () => live && setTexture(null));
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, [underlay.url]);
  if (!texture || !underlay.visible) return null;
  const floorY = (rooms.find((room) => room.id === underlay.roomId) ?? rooms[0])?.position.y ?? 0;
  return (
    <mesh position={[underlay.x, floorY + 0.006, underlay.z]} rotation={[-Math.PI / 2, 0, (-underlay.rotationDegrees * Math.PI) / 180]} renderOrder={2} raycast={() => null}>
      <planeGeometry args={[underlay.width, underlay.width * underlay.aspect]} />
      <meshBasicMaterial map={texture} transparent opacity={underlay.opacity} depthWrite={false} side={DoubleSide} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}
