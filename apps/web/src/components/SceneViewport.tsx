import { useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Edges,
  Grid,
  OrbitControls,
  PerspectiveCamera,
  RoundedBox,
} from "@react-three/drei";
import type { ComponentRef } from "react";
import type { FurnitureObject, Room } from "@reality-builder/shared";

type SceneViewportProps = {
  room: Room;
  furniture: FurnitureObject[];
  selectedEntityId: string;
  resetCameraSignal: number;
  onSelectEntity: (entityId: string) => void;
};

function RoomShell({ room }: { room: Room }) {
  const width = room.dimensions.width;
  const depth = room.dimensions.depth;
  const height = room.dimensions.height;
  const thickness = room.dimensions.wallThickness;
  const x = room.position.x;
  const z = room.position.z;
  const y = room.position.y;
  const wallMaterial = "#f7f8f5";

  return (
    <group position={[x, y, z]} rotation={[0, (room.yawDegrees * Math.PI) / 180, 0]}>
      <mesh position={[0, -0.055, 0]} receiveShadow>
        <boxGeometry args={[width, 0.11, depth]} />
        <meshStandardMaterial color="#d9ddd6" roughness={0.86} />
      </mesh>
      <mesh position={[0, height / 2, -depth / 2]} castShadow receiveShadow>
        <boxGeometry args={[width + thickness * 2, height, thickness]} />
        <meshStandardMaterial color={wallMaterial} roughness={0.88} />
      </mesh>
      <mesh position={[-width / 2, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[thickness, height, depth]} />
        <meshStandardMaterial color="#e8ece7" roughness={0.88} />
      </mesh>
      <mesh position={[width / 2, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[thickness, height, depth]} />
        <meshStandardMaterial color="#edf0eb" roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#c9b99f" roughness={0.9} />
      </mesh>
    </group>
  );
}

function FurnitureProxy({
  item,
  selected,
  onSelect,
}: {
  item: FurnitureObject;
  selected: boolean;
  onSelect: () => void;
}) {
  const centerY = item.position.y + item.dimensions.height / 2;

  return (
    <group
      position={[item.position.x, centerY, item.position.z]}
      rotation={[0, (item.yawDegrees * Math.PI) / 180, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <RoundedBox
        args={[item.dimensions.width, item.dimensions.height, item.dimensions.depth]}
        radius={0.035}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color={item.color ?? "#89968f"}
          roughness={0.78}
          metalness={0.02}
        />
        {selected ? <Edges scale={1.015} color="#347a65" /> : null}
      </RoundedBox>
    </group>
  );
}

function CameraControls({ resetSignal }: { resetSignal: number }) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);

  useEffect(() => {
    if (resetSignal > 0) controlsRef.current?.reset();
  }, [resetSignal]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, 0.8, 0]}
      minDistance={4.5}
      maxDistance={20}
      maxPolarAngle={Math.PI * 0.49}
      enableDamping
      dampingFactor={0.08}
    />
  );
}

export function SceneViewport({
  room,
  furniture,
  selectedEntityId,
  resetCameraSignal,
  onSelectEntity,
}: SceneViewportProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [8.6, 7.1, 9.4], fov: 38, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: false }}
      onPointerMissed={() => onSelectEntity("")}
    >
      <color attach="background" args={["#eaf0ed"]} />
      <hemisphereLight args={["#f9fcfa", "#98a49c", 1.35]} />
      <directionalLight
        castShadow
        position={[5, 9, 6]}
        intensity={2.2}
        shadow-mapSize={[1024, 1024]}
      />
      <PerspectiveCamera makeDefault position={[8.6, 7.1, 9.4]} fov={38} />
      <Grid
        args={[20, 20]}
        position={[0, -0.01, 0]}
        cellSize={0.5}
        cellThickness={0.55}
        cellColor="#aebbb4"
        sectionSize={2}
        sectionThickness={0.9}
        sectionColor="#82948a"
        fadeDistance={18}
        fadeStrength={1.1}
        infiniteGrid={false}
      />
      <RoomShell room={room} />
      {furniture.map((item) => (
        <FurnitureProxy
          key={item.id}
          item={item}
          selected={selectedEntityId === item.id}
          onSelect={() => onSelectEntity(item.id)}
        />
      ))}
      <ContactShadows
        position={[0, 0.012, 0]}
        opacity={0.22}
        scale={12}
        blur={2.2}
        far={4}
      />
      <CameraControls resetSignal={resetCameraSignal} />
    </Canvas>
  );
}
