import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Sky, Stars } from "@react-three/drei";
import { Color, Vector3, type DirectionalLight } from "three";
import type { EnvironmentMode, Room } from "@reality-builder/shared";

type Preset = {
  background: string;
  sunElevation: number;
  sunAzimuth: number;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  exposure: number;
  sky: { turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number } | null;
};

/** Artificial light multiplier per mode: lamps matter little at noon and dominate at night. */
export const ARTIFICIAL_LIGHT_FACTOR: Record<EnvironmentMode, number> = { day: 0.35, evening: 1, night: 1.6 };

export const PRESETS: Record<EnvironmentMode, Preset> = {
  day: {
    background: "#dbe9f2",
    sunElevation: 58, sunAzimuth: 145, sunColor: "#fff6e8", sunIntensity: 3.1,
    hemiSky: "#eef6ff", hemiGround: "#b9ad9b", hemiIntensity: 1.25, exposure: 1.0,
    sky: { turbidity: 3, rayleigh: 0.6, mieCoefficient: 0.004, mieDirectionalG: 0.8 },
  },
  evening: {
    background: "#e9b38c",
    sunElevation: 7, sunAzimuth: 250, sunColor: "#ff9a52", sunIntensity: 2.2,
    hemiSky: "#ffcf9e", hemiGround: "#5f4a45", hemiIntensity: 0.55, exposure: 1.05,
    sky: { turbidity: 9, rayleigh: 2.6, mieCoefficient: 0.012, mieDirectionalG: 0.94 },
  },
  night: {
    background: "#0b1322",
    sunElevation: 38, sunAzimuth: 60, sunColor: "#8fa6d9", sunIntensity: 0.12,
    hemiSky: "#22314f", hemiGround: "#0d0f14", hemiIntensity: 0.16, exposure: 1.15,
    sky: null,
  },
};

function sunDirection(elevation: number, azimuth: number) {
  const phi = (90 - elevation) * (Math.PI / 180);
  const theta = azimuth * (Math.PI / 180);
  return new Vector3().setFromSphericalCoords(1, phi, theta);
}

export function SceneEnvironment({ mode, room, shadows, plan = false }: { mode: EnvironmentMode; room: Room; shadows: boolean; plan?: boolean }) {
  const preset = PRESETS[mode];
  const sunRef = useRef<DirectionalLight>(null);
  const { gl, scene } = useThree();
  const direction = useMemo(() => sunDirection(preset.sunElevation, preset.sunAzimuth), [preset]);
  const span = Math.max(room.dimensions.width, room.dimensions.depth);
  const distance = span + 8;

  useEffect(() => {
    gl.toneMappingExposure = preset.exposure;
    // Plan view uses a neutral drafting background (the sky shader does not work with orthographic cameras).
    scene.background = new Color(plan ? "#eef1f3" : preset.background);
  }, [gl, scene, preset, plan]);

  useEffect(() => {
    const light = sunRef.current;
    if (!light) return;
    light.target.position.set(room.position.x, 0, room.position.z);
    light.target.updateMatrixWorld();
    // Fit the shadow camera to the room so shadow texels stay sharp.
    const camera = light.shadow.camera;
    const half = span * 0.75 + 1;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = 0.5;
    camera.far = distance * 2.5;
    camera.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  }, [room, span, distance, mode]);

  return (
    <>
      {preset.sky && !plan ? <Sky distance={4500} sunPosition={direction.clone().multiplyScalar(100).toArray()} {...preset.sky} /> : null}
      {mode === "night" && !plan ? <Stars radius={90} depth={40} count={2500} factor={3} saturation={0} fade speed={0.4} /> : null}
      <hemisphereLight args={[preset.hemiSky, preset.hemiGround, preset.hemiIntensity]} />
      <directionalLight
        ref={sunRef}
        position={[room.position.x + direction.x * distance, direction.y * distance, room.position.z + direction.z * distance]}
        color={preset.sunColor}
        intensity={preset.sunIntensity}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
    </>
  );
}
