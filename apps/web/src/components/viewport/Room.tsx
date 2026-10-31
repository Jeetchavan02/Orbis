import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line, Text } from "@react-three/drei";
import { CanvasTexture, MathUtils, RepeatWrapping, SRGBColorSpace, Vector3, type Group } from "three";
import type { Opening, Room, WallSide } from "@reality-builder/shared";

const DEG = Math.PI / 180;
const CUTAWAY_HEIGHT = 0.18;

type Segment = { from: number; to: number; bottom: number; top: number };

/** Splits one wall into solid pieces around its openings (along-wall coordinate, centered on the wall). */
function wallSegments(length: number, height: number, openings: Opening[]): Segment[] {
  const sorted = [...openings].sort((a, b) => a.offset - b.offset);
  const segments: Segment[] = [];
  let cursor = -length / 2;
  for (const opening of sorted) {
    const start = Math.max(-length / 2, opening.offset - opening.width / 2);
    const end = Math.min(length / 2, opening.offset + opening.width / 2);
    if (start > cursor) segments.push({ from: cursor, to: start, bottom: 0, top: height });
    if (opening.sillHeight > 0) segments.push({ from: start, to: end, bottom: 0, top: opening.sillHeight });
    const head = Math.min(height, opening.sillHeight + opening.height);
    if (head < height) segments.push({ from: start, to: end, bottom: head, top: height });
    cursor = Math.max(cursor, end);
  }
  if (cursor < length / 2) segments.push({ from: cursor, to: length / 2, bottom: 0, top: height });
  return segments;
}

const WALL_FRAMES: Record<WallSide, { normal: [number, number]; yaw: number }> = {
  north: { normal: [0, -1], yaw: 0 },
  south: { normal: [0, 1], yaw: 180 },
  west: { normal: [-1, 0], yaw: 90 },
  east: { normal: [1, 0], yaw: -90 },
};

function Wall({ room, side, cutaway }: { room: Room; side: WallSide; cutaway: boolean }) {
  const groupRef = useRef<Group>(null);
  const { width, depth, height, wallThickness: t } = room.dimensions;
  const horizontal = side === "north" || side === "south";
  const length = horizontal ? width + 2 * t : depth;
  const openings = room.openings.filter((opening) => opening.wall === side);
  const segments = useMemo(() => wallSegments(length, height, openings), [length, height, openings]);
  const frame = WALL_FRAMES[side];
  const center: [number, number] = horizontal ? [0, frame.normal[1] * (depth / 2 + t / 2)] : [frame.normal[0] * (width / 2 + t / 2), 0];
  const local = useMemo(() => new Vector3(), []);

  // Lower walls that stand between the camera and the room interior.
  useFrame(({ camera }, delta) => {
    const group = groupRef.current;
    const roomGroup = group?.parent?.parent;
    if (!group || !roomGroup) return;
    local.copy(camera.position);
    roomGroup.worldToLocal(local);
    const facing = cutaway && (local.x * frame.normal[0] + local.z * frame.normal[1] > (horizontal ? depth : width) / 2);
    const target = facing ? CUTAWAY_HEIGHT / height : 1;
    group.scale.y = MathUtils.damp(group.scale.y, target, 10, delta);
  });

  // The engine measures offsets along world +X (north/south) or +Z (east/west); the wall's yaw flips
  // local +X to point backwards along that axis for the south and west walls.
  const alongSign = side === "south" || side === "west" ? -1 : 1;
  return (
    <group position={[center[0], 0, center[1]]} rotation={[0, frame.yaw * DEG, 0]}>
      <group ref={groupRef}>
        {segments.map((segment, index) => (
          <mesh key={index} position={[((segment.from + segment.to) / 2) * alongSign, (segment.bottom + segment.top) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[segment.to - segment.from, segment.top - segment.bottom, t]} />
            <meshStandardMaterial color={room.wallColor} roughness={0.92} />
          </mesh>
        ))}
        {/* Dark cap reads the wall outline from above, as in plan drawings. */}
        {segments.filter((segment) => segment.top === height).map((segment, index) => (
          <mesh key={"cap" + index} position={[((segment.from + segment.to) / 2) * alongSign, height + 0.004, 0]}>
            <boxGeometry args={[segment.to - segment.from, 0.008, t + 0.002]} />
            <meshStandardMaterial color="#3d4542" roughness={0.6} />
          </mesh>
        ))}
        {openings.map((opening) => (
          <OpeningModel key={opening.id} opening={opening} along={opening.offset * alongSign} thickness={t} />
        ))}
      </group>
    </group>
  );
}

function OpeningModel({ opening, along, thickness }: { opening: Opening; along: number; thickness: number }) {
  const frame = 0.05;
  if (opening.kind === "window") {
    const y = opening.sillHeight + opening.height / 2;
    return (
      <group position={[along, y, 0]}>
        <mesh>
          <boxGeometry args={[opening.width, opening.height, 0.02]} />
          <meshPhysicalMaterial color="#cfe6f3" transmission={0.9} roughness={0.05} thickness={0.02} transparent opacity={0.35} />
        </mesh>
        {[[0, opening.height / 2 - frame / 2, opening.width, frame], [0, -opening.height / 2 + frame / 2, opening.width, frame], [-opening.width / 2 + frame / 2, 0, frame, opening.height], [opening.width / 2 - frame / 2, 0, frame, opening.height], [0, 0, frame * 0.6, opening.height]].map(([x, yy, w, h], index) => (
          <mesh key={index} position={[x!, yy!, 0]}>
            <boxGeometry args={[w!, h!, thickness + 0.01]} />
            <meshStandardMaterial color="#f7f6f2" roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, -opening.height / 2 - 0.02, thickness / 2 + 0.04]}>
          <boxGeometry args={[opening.width + 0.08, 0.03, 0.1]} />
          <meshStandardMaterial color="#efece6" roughness={0.6} />
        </mesh>
      </group>
    );
  }
  // Door: frame + leaf shown ajar. Wall-local +Z points into the room and −X is "left" seen from inside.
  const leafWidth = opening.width - frame * 2;
  const hingeSign = opening.hinge === "right" ? 1 : -1;
  const swingIn = opening.swing !== "out";
  const angle = (swingIn ? 1 : -1) * hingeSign * 35 * DEG;
  return (
    <group position={[along, 0, 0]}>
      {[[-opening.width / 2 + frame / 2, opening.height / 2, frame, opening.height], [opening.width / 2 - frame / 2, opening.height / 2, frame, opening.height], [0, opening.height - frame / 2, opening.width, frame]].map(([x, y, w, h], index) => (
        <mesh key={index} position={[x!, y!, 0]}>
          <boxGeometry args={[w!, h!, thickness + 0.02]} />
          <meshStandardMaterial color="#f2efe9" roughness={0.5} />
        </mesh>
      ))}
      <group position={[hingeSign * (opening.width / 2 - frame), 0, (swingIn ? 1 : -1) * thickness / 2]} rotation={[0, angle, 0]}>
        <mesh position={[-hingeSign * leafWidth / 2, (opening.height - frame) / 2, (swingIn ? 1 : -1) * 0.02]} castShadow>
          <boxGeometry args={[leafWidth, opening.height - frame, 0.04]} />
          <meshStandardMaterial color="#d9cbb6" roughness={0.6} />
        </mesh>
        <mesh position={[-hingeSign * (leafWidth - 0.08), 1.0, (swingIn ? 1 : -1) * 0.06]}>
          <sphereGeometry args={[0.025, 12, 12]} />
          <meshStandardMaterial color="#b9b2a5" metalness={0.8} roughness={0.25} />
        </mesh>
      </group>
    </group>
  );
}

export const RoomShell = memo(function RoomShell({ room, cutaway, showDimensions }: { room: Room; cutaway: boolean; showDimensions: boolean }) {
  const { width, depth, wallThickness: t } = room.dimensions;
  return (
    <group position={[room.position.x, room.position.y, room.position.z]} rotation={[0, room.yawDegrees * DEG, 0]}>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[width + 2 * t, 0.12, depth + 2 * t]} />
        <meshStandardMaterial color="#c9ccc6" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow userData={{ floor: true }}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={room.floorColor} roughness={0.78} map={woodGrain(width, depth)} />
      </mesh>
      {/* Subtle plank lines */}
      {Array.from({ length: Math.floor(width / 0.2) }, (_, index) => (
        <mesh key={index} position={[-width / 2 + (index + 1) * 0.2, 0.0015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.004, depth]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.05} />
        </mesh>
      )).slice(0, 120)}
      {(["north", "south", "east", "west"] as const).map((side) => (
        <Wall key={side} room={room} side={side} cutaway={cutaway} />
      ))}
      {showDimensions ? (
        <>
          <DimensionLine length={width + 2 * t} label={`${width.toFixed(2)} m`} position={[0, 0.02, depth / 2 + t + 0.4]} yaw={0} />
          <DimensionLine length={depth + 2 * t} label={`${depth.toFixed(2)} m`} position={[width / 2 + t + 0.4, 0.02, 0]} yaw={Math.PI / 2} />
        </>
      ) : null}
    </group>
  );
});

const grainCache = new Map<string, CanvasTexture>();
/** Procedural wood grain (multiplied by the floor colour), cached per floor size. */
function woodGrain(width: number, depth: number) {
  const key = width.toFixed(2) + "x" + depth.toFixed(2);
  const cached = grainCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let plank = 0; plank < 8; plank += 1) {
    const x = plank * 64;
    g.fillStyle = `rgb(0 0 0 / ${0.02 + rand() * 0.06})`;
    g.fillRect(x, 0, 64, 512);
    for (let line = 0; line < 14; line += 1) {
      g.strokeStyle = `rgb(60 35 15 / ${0.04 + rand() * 0.08})`;
      g.lineWidth = 0.6 + rand() * 1.2;
      g.beginPath();
      const lx = x + 4 + rand() * 56;
      g.moveTo(lx, 0);
      for (let y = 0; y <= 512; y += 32) g.lineTo(lx + Math.sin(y / 60 + plank + line) * 2.5, y);
      g.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(width / 1.6, depth / 1.6);
  texture.anisotropy = 4;
  grainCache.set(key, texture);
  return texture;
}

const DIM_INK = "#5a6660";

/**
 * Architectural dimension on the floor plane: |◄── label ──►| with end ticks, arrowheads,
 * and a gap in the line around the label. Drawn along local X, then rotated by `yaw`.
 */
function DimensionLine({ length, label, position, yaw }: { length: number; label: string; position: [number, number, number]; yaw: number }) {
  const half = length / 2;
  const tick = 0.14;
  const arrow = 0.12;
  const gap = Math.min(half - arrow - 0.05, label.length * 0.05 + 0.12);
  return (
    <group position={position} rotation={[0, -yaw, 0]}>
      <Line points={[[-half, 0, 0], [-gap, 0, 0]]} color={DIM_INK} lineWidth={1.4} />
      <Line points={[[gap, 0, 0], [half, 0, 0]]} color={DIM_INK} lineWidth={1.4} />
      <Line points={[[-half, 0, -tick], [-half, 0, tick]]} color={DIM_INK} lineWidth={1.4} />
      <Line points={[[half, 0, -tick], [half, 0, tick]]} color={DIM_INK} lineWidth={1.4} />
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (half - arrow / 2), 0, 0]} rotation={[-Math.PI / 2, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2]}>
          <coneGeometry args={[arrow * 0.32, arrow, 3]} />
          <meshBasicMaterial color={DIM_INK} />
        </mesh>
      ))}
      <Text position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.16} color={DIM_INK} anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  );
}
