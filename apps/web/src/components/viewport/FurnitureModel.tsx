import { memo, useMemo, type ReactNode } from "react";
import { BufferAttribute, BufferGeometry, Color, Mesh, DoubleSide } from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import type { FurnitureObject, MeshData } from "@reality-builder/shared";
import { catalogById, type ModelParams } from "../../data/catalog";

// BVH-accelerated raycasting for (potentially large) imported/edited meshes.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

type Vec3 = [number, number, number];

export function shade(hex: string, amount: number) {
  const color = new Color(hex);
  if (amount < 0) color.lerp(new Color("#000000"), -amount);
  else color.lerp(new Color("#ffffff"), amount);
  return "#" + color.getHexString();
}

type Mat = { color: string; roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number };
function Material(props: Mat) {
  return <meshStandardMaterial color={props.color} roughness={props.roughness ?? 0.75} metalness={props.metalness ?? 0} emissive={props.emissive ?? "#000000"} emissiveIntensity={props.emissiveIntensity ?? 0} transparent={props.transparent} opacity={props.opacity ?? 1} side={props.transparent ? DoubleSide : undefined} />;
}

/** Box by its min corner (local meters, origin = bottom-center of the object). */
function B({ s, at, m, cast = true, rot }: { s: Vec3; at: Vec3; m: Mat; cast?: boolean; rot?: Vec3 }) {
  return (
    <mesh position={[at[0] + s[0] / 2, at[1] + s[1] / 2, at[2] + s[2] / 2]} rotation={rot} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      <Material {...m} />
    </mesh>
  );
}
/** Vertical cylinder standing at (x, y, z). */
function C({ r, r2, h, at, m, seg = 20, cast = true, rot }: { r: number; r2?: number; h: number; at: Vec3; m: Mat; seg?: number; cast?: boolean; rot?: Vec3 }) {
  return (
    <mesh position={[at[0], at[1] + h / 2, at[2]]} rotation={rot} castShadow={cast} receiveShadow>
      <cylinderGeometry args={[r, r2 ?? r, h, seg]} />
      <Material {...m} />
    </mesh>
  );
}
function S({ r, at, m, scale, detail = 1, flat = false }: { r: number; at: Vec3; m: Mat; scale?: Vec3; detail?: number; flat?: boolean }) {
  return (
    <mesh position={at} scale={scale} castShadow receiveShadow>
      <icosahedronGeometry args={[r, detail]} />
      <meshStandardMaterial color={m.color} roughness={m.roughness ?? 0.8} metalness={m.metalness ?? 0} flatShading={flat} emissive={m.emissive ?? "#000000"} emissiveIntensity={m.emissiveIntensity ?? 0} />
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

type Ctx = { w: number; d: number; h: number; x0: number; z0: number; c: string; p: ModelParams; s: boolean; glow: boolean };
const str = (p: ModelParams, key: string, fallback: string) => (typeof p[key] === "string" ? (p[key] as string) : fallback);
const num = (p: ModelParams, key: string, fallback: number) => (typeof p[key] === "number" ? (p[key] as number) : fallback);
const bool = (p: ModelParams, key: string) => p[key] === true;
const METAL_DARK: Mat = { color: "#2b2b2b", roughness: 0.4, metalness: 0.7 };
const HANDLE: Mat = { color: "#c8c2b6", roughness: 0.3, metalness: 0.8 };

function legs4(x0: number, z0: number, w: number, d: number, h: number, style: string, color: string, inset = 0.04): ReactNode {
  if (style === "none") return null;
  const t = style === "metal" ? 0.02 : style === "block" ? 0.06 : 0.04;
  const m: Mat = style === "metal" ? METAL_DARK : { color: shade(color, -0.25), roughness: 0.6 };
  const spots: [number, number][] = [[x0 + inset, z0 + inset], [-x0 - inset - t, z0 + inset], [x0 + inset, -z0 - inset - t], [-x0 - inset - t, -z0 - inset - t]];
  return spots.map(([x, z], i) => style === "taper"
    ? <C key={i} r={t * 0.45} r2={t * 0.7} h={h} at={[x + t / 2, 0, z + t / 2]} m={m} seg={10} />
    : <B key={i} s={[t, h, t]} at={[x, 0, z]} m={m} />);
}

/** Upholstered seating: sofas, loveseats, armchairs. */
function Sofa({ w, d, h, x0, z0, c, p, s }: Ctx, sectional = false): ReactNode {
  const arm = str(p, "arm", "box");
  const leg = str(p, "leg", "block");
  const seats = num(p, "seats", 3);
  const legH = leg === "none" ? 0 : leg === "metal" ? 0.14 : 0.1;
  const armW = arm === "none" ? 0 : arm === "slim" ? 0.08 : arm === "barrel" ? 0.14 : 0.16;
  const backT = Math.min(0.2, d * 0.22);
  const seatTop = Math.min(0.46, h * 0.55);
  const baseH = seatTop - legH - 0.12;
  const fabric: Mat = { color: c, roughness: 0.95 };
  const darker: Mat = { color: shade(c, -0.12), roughness: 0.95 };
  const frame = typeof p.frame === "string" ? (p.frame as string) : c;
  const main = sectional ? Math.min(d, 0.95) : d;
  const mz0 = z0;
  const parts: ReactNode[] = [];
  parts.push(<B key="base" s={[w, baseH, main]} at={[x0, legH, mz0]} m={darker} cast={s} />);
  parts.push(<B key="back" s={[w, h - legH, backT]} at={[x0, legH, mz0]} m={fabric} cast={s} />);
  const innerW = w - armW * 2;
  const cushionCount = bool(p, "cushions") ? Math.max(1, seats) : 1;
  const cw = innerW / cushionCount;
  for (let i = 0; i < cushionCount; i += 1) {
    parts.push(<B key={"seat" + i} s={[cw - 0.015, 0.13, main - backT - 0.03]} at={[x0 + armW + i * cw + 0.007, legH + baseH, mz0 + backT + 0.01]} m={{ color: shade(c, 0.05), roughness: 1 }} cast={s} />);
    if (bool(p, "cushions")) parts.push(<B key={"bc" + i} s={[cw - 0.03, h - seatTop - 0.06, 0.16]} at={[x0 + armW + i * cw + 0.015, seatTop, mz0 + backT - 0.02]} m={{ color: shade(c, 0.08), roughness: 1 }} cast={s} rot={[-0.12, 0, 0]} />);
  }
  if (bool(p, "tufted")) {
    for (let i = 0; i < Math.round(w / 0.18); i += 1) {
      for (let j = 0; j < 2; j += 1) parts.push(<S key={`t${i}-${j}`} r={0.012} at={[x0 + 0.1 + i * 0.18, seatTop + 0.1 + j * 0.13, mz0 + backT + 0.005]} m={{ color: shade(c, -0.35) }} detail={0} />);
    }
  }
  if (bool(p, "wings")) {
    parts.push(<B key="wl" s={[0.1, h - seatTop - 0.05, 0.3]} at={[x0, seatTop, mz0 + backT]} m={fabric} cast={s} />);
    parts.push(<B key="wr" s={[0.1, h - seatTop - 0.05, 0.3]} at={[-x0 - 0.1, seatTop, mz0 + backT]} m={fabric} cast={s} />);
  }
  if (arm !== "none") {
    const armH = arm === "barrel" ? h - legH - 0.05 : Math.min(h - legH, seatTop - legH + 0.2);
    for (const x of [x0, -x0 - armW]) {
      parts.push(<B key={"arm" + x} s={[armW, armH, main]} at={[x, legH, mz0]} m={arm === "barrel" ? darker : fabric} cast={s} />);
      if (arm === "rolled") parts.push(<C key={"roll" + x} r={armW * 0.62} h={main} at={[x + armW / 2, legH + armH - 0.02, mz0 + main / 2]} m={fabric} rot={[Math.PI / 2, 0, 0]} />);
    }
  }
  if (sectional) {
    const chaiseW = Math.min(0.95, w * 0.36);
    const cx = str(p, "side", "right") === "right" ? -x0 - chaiseW : x0;
    parts.push(<B key="chaise" s={[chaiseW, baseH, d - main]} at={[cx, legH, z0 + main]} m={darker} cast={s} />);
    parts.push(<B key="chaiseCushion" s={[chaiseW - 0.02, 0.13, d - main - 0.02]} at={[cx + 0.01, legH + baseH, z0 + main]} m={{ color: shade(c, 0.05), roughness: 1 }} cast={s} />);
  }
  parts.push(<group key="legs">{legs4(x0, z0, w, sectional ? d : main, legH, leg, frame)}</group>);
  return <group>{parts}</group>;
}

function Chair({ w, d, h, x0, z0, c, p, s }: Ctx): ReactNode {
  const seatH = Math.min(0.46, h * 0.52);
  const back = str(p, "back", "panel");
  const leg = str(p, "leg", "taper");
  const wood: Mat = { color: c, roughness: 0.6 };
  const seat: Mat = { color: str(p, "seatColor", c), roughness: back === "upholstered" ? 1 : 0.6 };
  const parts: ReactNode[] = [legs4(x0, z0, w, d, seatH - 0.04, leg === "metal" ? "metal" : "taper", c, 0.03)];
  parts.push(<B key="seat" s={[w, back === "upholstered" ? 0.08 : 0.04, d]} at={[x0, seatH - 0.04, z0]} m={seat} cast={s} />);
  const backH = h - seatH;
  if (back === "panel") parts.push(<B key="b" s={[w, backH * 0.55, 0.03]} at={[x0, h - backH * 0.55, z0]} m={wood} cast={s} />);
  if (back === "upholstered") parts.push(<B key="b" s={[w, backH, 0.07]} at={[x0, seatH, z0]} m={seat} cast={s} />);
  if (back === "curve") parts.push(<B key="b" s={[w, backH * 0.35, 0.03]} at={[x0, h - backH * 0.35, z0 + 0.02]} m={wood} cast={s} rot={[0.15, 0, 0]} />);
  if (back === "slats" || back === "spindles" || back === "curve") {
    parts.push(<B key="post1" s={[0.03, backH, 0.03]} at={[x0, seatH, z0]} m={leg === "metal" ? METAL_DARK : wood} />);
    parts.push(<B key="post2" s={[0.03, backH, 0.03]} at={[-x0 - 0.03, seatH, z0]} m={leg === "metal" ? METAL_DARK : wood} />);
    if (back !== "curve") parts.push(<B key="top" s={[w, 0.05, 0.03]} at={[x0, h - 0.05, z0]} m={wood} />);
    const n = back === "spindles" ? 5 : 3;
    for (let i = 0; i < n; i += 1) {
      parts.push(back === "spindles"
        ? <C key={"sp" + i} r={0.008} h={backH - 0.05} at={[x0 + (w / (n + 1)) * (i + 1), seatH, z0 + 0.015]} m={wood} seg={6} />
        : <B key={"sl" + i} s={[w - 0.06, 0.04, 0.02]} at={[x0 + 0.03, seatH + 0.12 + i * 0.1, z0 + 0.005]} m={leg === "metal" ? METAL_DARK : wood} />);
    }
  }
  return <group>{parts}</group>;
}

function OfficeChair({ w, d, h, c, p, s }: Ctx): ReactNode {
  const seatH = 0.48;
  const parts: ReactNode[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(<B key={"star" + i} s={[0.03, 0.03, Math.min(w, d) / 2]} at={[-0.015, 0.04, 0]} m={METAL_DARK} rot={[0, a, 0]} />);
    parts.push(<S key={"wheel" + i} r={0.03} at={[Math.sin(a) * Math.min(w, d) * 0.45, 0.03, Math.cos(a) * Math.min(w, d) * 0.45]} m={METAL_DARK} detail={0} />);
  }
  parts.push(<C key="lift" r={0.025} h={seatH - 0.1} at={[0, 0.06, 0]} m={{ color: "#888", metalness: 0.8, roughness: 0.3 }} />);
  parts.push(<B key="seat" s={[w * 0.82, 0.08, d * 0.75]} at={[-w * 0.41, seatH - 0.08, -d * 0.3]} m={{ color: c, roughness: 0.9 }} cast={s} />);
  const backH = h - seatH - (bool(p, "headrest") ? 0.12 : 0);
  parts.push(<B key="back" s={[w * 0.75, backH, 0.05]} at={[-w * 0.375, seatH + 0.02, -d * 0.4]} m={{ color: str(p, "back", "mesh") === "mesh" ? shade(c, -0.15) : c, roughness: 0.9 }} cast={s} rot={[-0.1, 0, 0]} />);
  if (bool(p, "headrest")) parts.push(<B key="head" s={[w * 0.45, 0.1, 0.05]} at={[-w * 0.225, h - 0.12, -d * 0.45]} m={{ color: c, roughness: 0.9 }} />);
  if (bool(p, "arms")) for (const x of [-w / 2, w / 2 - 0.05]) parts.push(<B key={"arm" + x} s={[0.05, 0.2, d * 0.45]} at={[x, seatH, -d * 0.2]} m={METAL_DARK} />);
  return <group>{parts}</group>;
}

function Bed({ w, d, h, x0, z0, c, p, s }: Ctx): ReactNode {
  const head = str(p, "headboard", "panel");
  const frameColor = str(p, "frame", "#8f735b");
  const upholstered = frameColor === "#8a8d91";
  const frameM: Mat = { color: frameColor, roughness: upholstered ? 1 : 0.6 };
  const frameH = head === "low" ? 0.22 : 0.3;
  const headD = 0.08;
  const matH = 0.22;
  const pillows = w > 1.2 ? 2 : 1;
  const pw = Math.min(0.62, (w - 0.2) / pillows);
  const parts: ReactNode[] = [
    <B key="frame" s={[w, frameH, d - headD]} at={[x0, 0, z0 + headD]} m={frameM} cast={s} />,
    <B key="mattress" s={[w - 0.06, matH, d - headD - 0.06]} at={[x0 + 0.03, frameH, z0 + headD + 0.03]} m={{ color: "#f4f2ee", roughness: 1 }} cast={s} />,
    <B key="duvet" s={[w - 0.02, 0.06, (d - headD) * 0.62]} at={[x0 + 0.01, frameH + matH, z0 + headD + (d - headD) * 0.37]} m={{ color: c, roughness: 1 }} cast={s} />,
    <B key="throw" s={[w + 0.01, 0.065, 0.35]} at={[x0 - 0.005, frameH + matH, -z0 - 0.45]} m={{ color: shade(frameColor, 0.2), roughness: 1 }} cast={false} />,
  ];
  for (let i = 0; i < pillows; i += 1) parts.push(<B key={"p" + i} s={[pw, 0.12, 0.36]} at={[x0 + (w - pillows * pw - (pillows - 1) * 0.06) / 2 + i * (pw + 0.06), frameH + matH, z0 + headD + 0.06]} m={{ color: "#ffffff", roughness: 1 }} cast={s} />);
  if (head === "low") parts.push(<B key="hb" s={[w, h, headD]} at={[x0, 0, z0]} m={frameM} cast={s} />);
  if (head === "panel") parts.push(<B key="hb" s={[w, h, headD]} at={[x0, 0, z0]} m={{ color: shade(frameColor, -0.12), roughness: 0.6 }} cast={s} />);
  if (head === "tufted") {
    parts.push(<B key="hb" s={[w, h, headD + 0.04]} at={[x0, 0, z0]} m={{ color: upholstered ? frameColor : "#a59c92", roughness: 1 }} cast={s} />);
    for (let i = 1; i < w / 0.2; i += 1) for (let j = 0; j < 2; j += 1) parts.push(<S key={`tb${i}-${j}`} r={0.012} at={[x0 + i * 0.2, h - 0.15 - j * 0.15, z0 + headD + 0.045]} m={{ color: "#555" }} detail={0} />);
  }
  if (head === "slat") {
    parts.push(<B key="rail" s={[w, 0.06, headD]} at={[x0, h - 0.06, z0]} m={frameM} />);
    for (let i = 0; i <= Math.round(w / 0.14); i += 1) parts.push(<B key={"sl" + i} s={[0.05, h - 0.06, 0.03]} at={[x0 + Math.min(w - 0.05, i * 0.14), 0, z0 + 0.025]} m={frameM} />);
  }
  return <group>{parts}</group>;
}

/** Case goods: nightstands, dressers, cabinets, toy chests. */
function Case({ w, d, h, x0, z0, c, p, s }: Ctx, kind: "drawers" | "doors"): ReactNode {
  const base = str(p, "base", "plinth");
  const legH = base === "legs" ? 0.14 : base === "float" ? 0.06 : base === "classic" ? 0.08 : 0.04;
  const bodyH = h - legH;
  const body: Mat = { color: c, roughness: 0.6 };
  const front: Mat = { color: shade(c, 0.07), roughness: 0.55 };
  const parts: ReactNode[] = [<B key="body" s={[w, bodyH, d - 0.02]} at={[x0, legH, z0]} m={body} cast={s} />];
  if (base === "legs") parts.push(<group key="l">{legs4(x0, z0, w, d, legH, "taper", c)}</group>);
  else parts.push(<B key="plinth" s={[w - (base === "float" ? 0.2 : 0.04), legH, d - 0.08]} at={[x0 + (base === "float" ? 0.1 : 0.02), 0, z0 + 0.03]} m={{ color: shade(c, -0.3) }} cast={false} />);
  if (base === "classic") parts.push(<B key="top" s={[w + 0.03, 0.03, d + 0.01]} at={[x0 - 0.015, h - 0.03, z0 - 0.005]} m={{ color: shade(c, -0.08) }} />);
  const handleless = base === "float";
  if (kind === "drawers") {
    const rows = num(p, "drawers", 2);
    const cols = num(p, "columns", 1);
    const dh = (bodyH - 0.04) / rows;
    const dw = (w - 0.04) / cols;
    for (let r = 0; r < rows; r += 1) for (let col = 0; col < cols; col += 1) {
      parts.push(<B key={`d${r}-${col}`} s={[dw - 0.012, dh - 0.012, 0.02]} at={[x0 + 0.02 + col * dw + 0.006, legH + 0.02 + r * dh + 0.006, -z0 - 0.02]} m={front} cast={false} />);
      if (!handleless) parts.push(<B key={`h${r}-${col}`} s={[Math.min(0.14, dw * 0.35), 0.015, 0.02]} at={[x0 + 0.02 + col * dw + dw / 2 - Math.min(0.07, dw * 0.175), legH + 0.02 + r * dh + dh / 2, -z0]} m={HANDLE} cast={false} />);
    }
  } else {
    const doors = num(p, "doors", 2);
    const dw = (w - 0.04) / doors;
    for (let i = 0; i < doors; i += 1) {
      parts.push(<B key={"door" + i} s={[dw - 0.012, bodyH - 0.05, 0.02]} at={[x0 + 0.02 + i * dw + 0.006, legH + 0.025, -z0 - 0.02]} m={front} cast={false} />);
      if (!handleless) parts.push(<B key={"dh" + i} s={[0.015, Math.min(0.2, bodyH * 0.25), 0.02]} at={[x0 + 0.02 + i * dw + (i % 2 === 0 ? dw - 0.05 : 0.035), legH + bodyH * 0.5, -z0]} m={HANDLE} cast={false} />);
    }
  }
  return <group>{parts}</group>;
}

function Wardrobe({ w, d, h, x0, z0, c, p, s }: Ctx): ReactNode {
  const doors = num(p, "doors", 2);
  const dw = (w - 0.02) / doors;
  const parts: ReactNode[] = [<B key="body" s={[w, h - 0.05, d - 0.02]} at={[x0, 0.05, z0]} m={{ color: c, roughness: 0.6 }} cast={s} />, <B key="plinth" s={[w - 0.04, 0.05, d - 0.06]} at={[x0 + 0.02, 0, z0 + 0.02]} m={{ color: shade(c, -0.3) }} />];
  const sliding = bool(p, "sliding");
  for (let i = 0; i < doors; i += 1) {
    const mirror = bool(p, "mirror") && i === 0;
    parts.push(<B key={"door" + i} s={[sliding ? w / 2 + 0.02 : dw - 0.01, h - 0.1, 0.02]} at={[sliding ? x0 + (i === 0 ? 0.005 : w / 2 - 0.025) : x0 + 0.01 + i * dw + 0.005, 0.07, -z0 - (sliding && i === 1 ? 0.045 : 0.02)]} m={mirror ? { color: "#dfe7ec", metalness: 0.9, roughness: 0.08 } : { color: shade(c, 0.06), roughness: 0.55 }} cast={false} />);
    if (!sliding) parts.push(<B key={"h" + i} s={[0.015, 0.32, 0.025]} at={[x0 + 0.01 + i * dw + (i % 2 === 0 ? dw - 0.045 : 0.03), h * 0.45, -z0]} m={HANDLE} cast={false} />);
  }
  return <group>{parts}</group>;
}

const BOOK_COLORS = ["#7c5a46", "#4e6a77", "#b99a5b", "#7f8f6a", "#9a5a5a", "#d8cfbf", "#3d4a5c"];
function Bookshelf({ w, d, h, x0, z0, c, p, s }: Ctx): ReactNode {
  const shelves = num(p, "shelves", 4);
  const m: Mat = { color: c, roughness: 0.6 };
  const step = (h - 0.03) / shelves;
  const parts: ReactNode[] = [<B key="l" s={[0.025, h, d]} at={[x0, 0, z0]} m={m} cast={s} />, <B key="r" s={[0.025, h, d]} at={[-x0 - 0.025, 0, z0]} m={m} cast={s} />];
  if (!bool(p, "open")) parts.push(<B key="back" s={[w, h, 0.012]} at={[x0, 0, z0]} m={{ color: shade(c, -0.18) }} cast={s} />);
  for (let i = 0; i <= shelves; i += 1) parts.push(<B key={"s" + i} s={[w - 0.05, 0.025, d - 0.012]} at={[x0 + 0.025, i * step, z0 + 0.012]} m={m} cast={false} />);
  for (let k = 1; k <= num(p, "dividers", 0); k += 1) parts.push(<B key={"div" + k} s={[0.02, h, d - 0.012]} at={[x0 + (w / (num(p, "dividers", 0) + 1)) * k, 0, z0 + 0.012]} m={m} cast={false} />);
  if (bool(p, "books")) {
    for (let r = 0; r < shelves; r += 1) {
      let x = x0 + 0.04;
      let i = 0;
      while (x < -x0 - 0.12 && i < 40) {
        const bw = 0.025 + ((r * 7 + i * 3) % 4) * 0.008;
        const bh = Math.min(step - 0.05, 0.18 + ((r + i) % 3) * 0.035);
        if ((r * 5 + i) % 9 !== 4) parts.push(<B key={`bk${r}-${i}`} s={[bw, bh, d * 0.7]} at={[x, r * step + 0.025, z0 + 0.03]} m={{ color: BOOK_COLORS[(r * 3 + i) % BOOK_COLORS.length]!, roughness: 0.8 }} cast={false} />);
        x += bw + 0.004;
        i += 1;
      }
    }
  } else {
    for (let r = 0; r < shelves; r += 1) parts.push(<C key={"v" + r} r={0.05} h={0.16} at={[x0 + 0.15 + (r % 2) * (w * 0.5), r * step + 0.025, 0]} m={{ color: ["#e7e1d6", "#7f9e8a", "#c98b6b"][r % 3]! }} seg={12} />);
  }
  return <group>{parts}</group>;
}

function Table({ w, d, h, x0, z0, c, p, s }: Ctx): ReactNode {
  const legs = str(p, "legs", "taper");
  const top = 0.04;
  const m: Mat = { color: c, roughness: 0.5 };
  const parts: ReactNode[] = [<B key="top" s={[w, top, d]} at={[x0, h - top, z0]} m={m} cast={s} />];
  if (legs === "taper" || legs === "hairpin") parts.push(<group key="l">{legs4(x0, z0, w, d, h - top, legs === "hairpin" ? "metal" : "taper", c, 0.06)}</group>);
  if (legs === "trestle") for (const x of [x0 + 0.15, -x0 - 0.21]) {
    parts.push(<B key={"t" + x} s={[0.06, h - top - 0.05, 0.08]} at={[x, 0.05, -0.04]} m={m} cast={s} />);
    parts.push(<B key={"f" + x} s={[0.08, 0.05, d * 0.75]} at={[x - 0.01, 0, -d * 0.375]} m={m} />);
  }
  if (legs === "trestle") parts.push(<B key="stretch" s={[w - 0.4, 0.05, 0.05]} at={[x0 + 0.2, 0.25, -0.025]} m={m} />);
  if (legs === "panel") for (const x of [x0, -x0 - top]) parts.push(<B key={"p" + x} s={[top, h - top, d]} at={[x, 0, z0]} m={m} cast={s} />);
  if (legs === "frame") for (const x of [x0 + 0.08, -x0 - 0.13]) {
    parts.push(<B key={"fc" + x} s={[0.05, h - top, 0.05]} at={[x, 0, -0.025]} m={METAL_DARK} />);
    parts.push(<B key={"ff" + x} s={[0.06, 0.03, d * 0.85]} at={[x - 0.005, 0, -d * 0.425]} m={METAL_DARK} />);
  }
  if (bool(p, "pedestal")) {
    parts.push(<B key="ped" s={[Math.min(0.42, w * 0.35), h - top - 0.02, d - 0.06]} at={[-x0 - Math.min(0.42, w * 0.35) - 0.03, 0.02, z0 + 0.03]} m={{ color: shade(c, 0.05) }} cast={s} />);
    for (let i = 0; i < 3; i += 1) parts.push(<B key={"ph" + i} s={[0.12, 0.015, 0.02]} at={[-x0 - Math.min(0.42, w * 0.35) / 2 - 0.09, 0.15 + i * ((h - 0.1) / 3), -z0 - 0.03]} m={HANDLE} cast={false} />);
  }
  if (bool(p, "corner")) parts.push(<B key="return" s={[0.6, top, d - 0.6]} at={[x0, h - top, z0 + 0.6]} m={m} cast={s} />);
  return <group>{parts}</group>;
}

function Lampshade({ shadeType, r, hgt, at, c, glow }: { shadeType: string; r: number; hgt: number; at: Vec3; c: string; glow: boolean }) {
  const m: Mat = { color: c, roughness: 0.9, emissive: glow ? "#ffd59a" : undefined, emissiveIntensity: glow ? 0.8 : 0 };
  if (shadeType === "globe") return <S r={r} at={[at[0], at[1] + r, at[2]]} m={{ color: "#f6f1e4", roughness: 0.3, emissive: glow ? "#ffe1b0" : undefined, emissiveIntensity: glow ? 1.1 : 0 }} detail={3} />;
  if (shadeType === "cone" || shadeType === "dome") return <C r={r * 0.25} r2={r} h={hgt} at={at} m={m} seg={28} />;
  if (shadeType === "cylinder") return <C r={r * 0.7} h={hgt} at={at} m={m} seg={24} />;
  return <C r={r * 0.75} r2={r} h={hgt} at={at} m={m} seg={28} />;
}

function Plant({ w, h, c, p, s }: Ctx): ReactNode {
  const foliage = str(p, "foliage", "bush");
  const pot = str(p, "pot", "ceramic");
  const potH = Math.min(0.35, h * 0.3);
  const potR = w * 0.38;
  const potM: Mat = { color: str(p, "potColor", "#e7e1d6"), roughness: pot === "ceramic" ? 0.35 : 0.9 };
  const leaf: Mat = { color: c, roughness: 0.85 };
  const leaf2: Mat = { color: shade(c, -0.15), roughness: 0.85 };
  const parts: ReactNode[] = [<C key="pot" r={potR} r2={potR * (pot === "basket" ? 0.95 : 0.78)} h={potH} at={[0, 0, 0]} m={potM} seg={pot === "basket" ? 10 : 24} />, <C key="soil" r={potR * 0.92} h={0.01} at={[0, potH - 0.012, 0]} m={{ color: "#3b2e24" }} cast={false} />];
  const top = h - potH;
  if (foliage === "bush") [[0, 0.55, 0, 0.42], [0.18, 0.7, -0.1, 0.32], [-0.16, 0.66, 0.12, 0.3], [0, 0.85, 0, 0.26]].forEach(([x, y, z, r], i) => parts.push(<S key={"b" + i} r={w * r!} at={[x! * w, potH + top * y!, z! * w]} m={i % 2 ? leaf2 : leaf} flat />));
  if (foliage === "fiddle") {
    parts.push(<C key="stem" r={0.012} h={top * 0.95} at={[0, potH, 0]} m={{ color: "#5b4a39" }} seg={6} />);
    for (let i = 0; i < 9; i += 1) {
      const a = i * 2.4;
      parts.push(<S key={"l" + i} r={w * 0.16} at={[Math.sin(a) * w * 0.18, potH + top * (0.35 + i * 0.07), Math.cos(a) * w * 0.18]} m={i % 2 ? leaf2 : leaf} scale={[1, 1.3, 0.35]} flat />);
    }
  }
  if (foliage === "snake") for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(<B key={"bl" + i} s={[0.05, top * (0.7 + (i % 3) * 0.12), 0.012]} at={[Math.sin(a) * potR * 0.5 - 0.025, potH, Math.cos(a) * potR * 0.5]} m={i % 2 ? leaf2 : { color: shade(c, 0.1) }} rot={[0.08 * Math.cos(a), a, 0.08 * Math.sin(a)]} />);
  }
  if (foliage === "palm") {
    for (let i = 0; i < 3; i += 1) parts.push(<C key={"st" + i} r={0.01} h={top * 0.7} at={[(i - 1) * 0.04, potH, 0]} m={{ color: "#6b7d3a" }} seg={5} />);
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2;
      parts.push(<B key={"fr" + i} s={[0.07, 0.01, w * 0.5]} at={[-0.035, potH + top * (0.65 + (i % 3) * 0.1), 0]} m={i % 2 ? leaf2 : leaf} rot={[0.5, a, 0]} />);
    }
  }
  if (foliage === "succulent") for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(<S key={"su" + i} r={w * 0.13} at={[Math.sin(a) * w * 0.16, potH + 0.03, Math.cos(a) * w * 0.16]} m={{ color: shade("#7fa98a", (i % 3) * 0.08) }} scale={[0.7, 1.4, 0.7]} flat />);
  }
  void s;
  return <group>{parts}</group>;
}

/**
 * Parametric furniture models. Every part stays inside the object's bounding box, so what users see
 * matches the collider the spatial engine checks. Families and parameters come from the catalog entry.
 */
export const FurnitureModel = memo(function FurnitureModel({ item, lowDetail, castShadow, lightOn }: { item: FurnitureObject; lowDetail: boolean; castShadow: boolean; lightOn: boolean }) {
  const meshGeometry = useMeshGeometry(item.mesh);
  const entry = catalogById(item.catalogItemId);
  const { width: w, depth: d, height: h } = item.dimensions;
  const c = item.color ?? entry?.color ?? "#9aa39e";
  const x0 = -w / 2;
  const z0 = -d / 2;

  if (meshGeometry) {
    return (
      <mesh geometry={meshGeometry} castShadow={castShadow} receiveShadow userData={{ editableMesh: true }}>
        <meshStandardMaterial color={c} roughness={0.65} flatShading />
      </mesh>
    );
  }
  if (lowDetail || !entry) return <B s={[w, h, d]} at={[x0, 0, z0]} m={{ color: c }} cast={false} />;
  return <>{renderFamily({ w, d, h, x0, z0, c, p: entry.params, s: castShadow, glow: lightOn }, entry.family)}</>;
});

export function renderFamily(ctx: Ctx, family: string): ReactNode {
  const { w, d, h, x0, z0, c, p, s, glow } = ctx;
  const wood: Mat = { color: c, roughness: 0.55 };
  switch (family) {
    case "sofa":
    case "armchair":
      return Sofa(ctx);
    case "sectional":
      return Sofa(ctx, true);
    case "recliner":
      return (
        <group>
          {Sofa({ ...ctx, p: { arm: "box", leg: "none", back: 0.4, cushions: true, seats: 1 }, d: d * 0.78, z0 })}
          <B s={[w - 0.3, 0.16, d * 0.22]} at={[x0 + 0.15, 0.2, -z0 - d * 0.22]} m={{ color: shade(c, -0.1), roughness: 1 }} cast={s} />
        </group>
      );
    case "chair":
      return Chair(ctx);
    case "office-chair":
      return OfficeChair(ctx);
    case "stool": {
      const round = str(p, "seat", "round") === "round";
      return (
        <group>
          {str(p, "base", "legs") === "pedestal"
            ? <><C r={w * 0.4} h={0.02} at={[0, 0, 0]} m={METAL_DARK} /><C r={0.025} h={h - 0.06} at={[0, 0.02, 0]} m={{ color: "#999", metalness: 0.8, roughness: 0.3 }} /></>
            : legs4(x0, z0, w, d, h - 0.04, "taper", c, 0.05)}
          {round ? <C r={w / 2} h={0.05} at={[0, h - 0.05, 0]} m={wood} cast={s} /> : <B s={[w, 0.05, d]} at={[x0, h - 0.05, z0]} m={wood} cast={s} />}
          <C r={w * 0.36} h={0.012} at={[0, h * 0.35, 0]} m={wood} />
        </group>
      );
    }
    case "bench":
      return (
        <group>
          <B s={[w, 0.05, d]} at={[x0, 0.41, z0]} m={wood} cast={s} />
          {str(p, "legs", "taper") === "panel" ? [x0, -x0 - 0.05].map((x) => <B key={x} s={[0.05, 0.41, d]} at={[x, 0, z0]} m={wood} cast={s} />) : legs4(x0, z0, w, d, 0.41, "taper", c, 0.05)}
          {bool(p, "back") ? <><B s={[w, 0.35, 0.04]} at={[x0, h - 0.35, z0]} m={wood} cast={s} rot={[-0.1, 0, 0]} /></> : null}
        </group>
      );
    case "bed":
      return Bed(ctx);
    case "bunk-bed": {
      const frame: Mat = { color: str(p, "frame", "#c49a6c"), roughness: 0.6 };
      return (
        <group>
          {[[x0, z0], [-x0 - 0.06, z0], [x0, -z0 - 0.06], [-x0 - 0.06, -z0 - 0.06]].map(([x, z], i) => <B key={i} s={[0.06, h, 0.06]} at={[x!, 0, z!]} m={frame} cast={s} />)}
          {[0.15, h * 0.62].map((y) => (
            <group key={y}>
              <B s={[w - 0.04, 0.08, d - 0.04]} at={[x0 + 0.02, y, z0 + 0.02]} m={frame} cast={s} />
              <B s={[w - 0.1, 0.16, d - 0.1]} at={[x0 + 0.05, y + 0.08, z0 + 0.05]} m={{ color: "#f3f1ec", roughness: 1 }} cast={s} />
              <B s={[w - 0.08, 0.05, d * 0.6]} at={[x0 + 0.04, y + 0.24, -z0 - d * 0.62]} m={{ color: c, roughness: 1 }} />
            </group>
          ))}
          <B s={[w, 0.12, 0.03]} at={[x0, h - 0.12, z0]} m={frame} />
          {[0, 1, 2, 3].map((i) => <B key={i} s={[0.32, 0.03, 0.03]} at={[-x0 - 0.38, 0.35 + i * 0.25, -z0 - 0.04]} m={frame} />)}
        </group>
      );
    }
    case "crib":
      return (
        <group>
          {legs4(x0, z0, w, d, 0.3, "taper", c, 0.01)}
          <B s={[w, 0.06, d]} at={[x0, 0.3, z0]} m={wood} cast={s} />
          <B s={[w - 0.08, 0.1, d - 0.08]} at={[x0 + 0.04, 0.36, z0 + 0.04]} m={{ color: "#f6f3ec", roughness: 1 }} />
          {[x0, -x0 - 0.03].flatMap((x) => [<B key={"t" + x} s={[0.03, 0.04, d]} at={[x, h - 0.04, z0]} m={wood} />])}
          {Array.from({ length: Math.round(d / 0.08) }, (_, i) => [x0, -x0 - 0.02].map((x) => <B key={`s${i}${x}`} s={[0.02, h - 0.36, 0.02]} at={[x, 0.36, z0 + i * 0.08]} m={wood} cast={false} />))}
          {[z0, -z0 - 0.03].map((z) => <B key={"e" + z} s={[w, h - 0.3, 0.03]} at={[x0, 0.3, z]} m={wood} cast={s} />)}
        </group>
      );
    case "nightstand":
    case "dresser":
      return Case(ctx, "drawers");
    case "cabinet":
      return Case(ctx, "doors");
    case "toy-box":
      return (
        <group>
          <B s={[w, h - 0.06, d]} at={[x0, 0, z0]} m={{ color: c, roughness: 0.6 }} cast={s} />
          <B s={[w + 0.02, 0.06, d + 0.02]} at={[x0 - 0.01, h - 0.06, z0 - 0.01]} m={{ color: shade(c, 0.2) }} cast={s} />
          <S r={0.05} at={[0, h * 0.5, -z0 + 0.02]} m={{ color: "#f4d35e" }} scale={[1, 1, 0.3]} />
        </group>
      );
    case "wardrobe":
      return Wardrobe(ctx);
    case "bookshelf":
      return Bookshelf(ctx);
    case "wall-shelf":
      return (
        <group>
          <B s={[w, 0.03, d]} at={[x0, 0, z0]} m={wood} cast={s} />
          {bool(p, "double") ? <B s={[w, 0.03, d]} at={[x0, h - 0.03, z0]} m={wood} cast={s} /> : null}
          <C r={0.05} h={0.1} at={[x0 + 0.15, 0.03, 0]} m={{ color: "#e7e1d6" }} seg={12} />
          <B s={[0.05, 0.11, d * 0.7]} at={[-x0 - 0.3, 0.03, z0 + 0.02]} m={{ color: "#7c5a46" }} /><B s={[0.04, 0.12, d * 0.7]} at={[-x0 - 0.24, 0.03, z0 + 0.02]} m={{ color: "#4e6a77" }} />
        </group>
      );
    case "tv-unit": {
      const n = num(p, "compartments", 3);
      const legH = bool(p, "legs") ? 0.1 : 0.02;
      return (
        <group>
          <B s={[w, h - legH, d]} at={[x0, legH, z0]} m={wood} cast={s} />
          {bool(p, "legs") ? legs4(x0, z0, w, d, legH, "taper", c) : null}
          {Array.from({ length: n }, (_, i) => (
            <B key={i} s={[(w - 0.04) / n - 0.015, h - legH - 0.06, 0.02]} at={[x0 + 0.02 + (i * (w - 0.04)) / n + 0.007, legH + 0.03, -z0 - 0.015]} m={bool(p, "doors") || i % 2 === 0 ? { color: shade(c, 0.08), roughness: 0.5 } : { color: shade(c, -0.4) }} cast={false} />
          ))}
        </group>
      );
    }
    case "table":
    case "desk":
      return Table(ctx);
    case "round-table": {
      const r = Math.min(w, d) / 2;
      return (
        <group>
          <C r={r} h={0.04} at={[0, h - 0.04, 0]} m={wood} cast={s} seg={40} />
          {str(p, "base", "pedestal") === "pedestal"
            ? <><C r={0.06} h={h - 0.04} at={[0, 0, 0]} m={wood} /><C r={r * 0.45} r2={r * 0.5} h={0.04} at={[0, 0, 0]} m={wood} /></>
            : [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; return <C key={i} r={0.02} r2={0.03} h={h - 0.04} at={[Math.sin(a) * r * 0.65, 0, Math.cos(a) * r * 0.65]} m={wood} seg={8} />; })}
        </group>
      );
    }
    case "coffee-table": {
      const shapeKey = str(p, "shape", "rect");
      if (shapeKey === "round") return <group><C r={w / 2} h={0.05} at={[0, h - 0.05, 0]} m={wood} cast={s} seg={40} /><C r={w * 0.35} h={h - 0.05} at={[0, 0, 0]} m={{ color: shade(c, -0.1) }} seg={32} /></group>;
      if (shapeKey === "nest") return <group><B s={[w * 0.65, 0.03, d]} at={[x0, h - 0.03, z0]} m={wood} cast={s} />{legs4(x0, z0, w * 0.65, d, h - 0.03, "metal", c, 0.02)}<B s={[w * 0.55, 0.03, d * 0.8]} at={[-x0 - w * 0.55, h * 0.75, z0 + 0.03]} m={{ color: shade(c, 0.1) }} cast={s} /></group>;
      return (
        <group>
          <B s={[w, 0.04, d]} at={[x0, h - 0.04, z0]} m={bool(p, "glass") ? { color: "#cfe3e6", roughness: 0.05, transparent: true, opacity: 0.4 } : wood} cast={s} />
          {legs4(x0, z0, w, d, h - 0.04, bool(p, "glass") ? "metal" : "taper", c, 0.04)}
          {bool(p, "shelf") ? <B s={[w - 0.1, 0.02, d - 0.1]} at={[x0 + 0.05, 0.1, z0 + 0.05]} m={wood} cast={false} /> : null}
        </group>
      );
    }
    case "side-table": {
      const shapeKey = str(p, "shape", "round");
      return (
        <group>
          {shapeKey === "square" ? <B s={[w, 0.03, d]} at={[x0, h - 0.03, z0]} m={wood} cast={s} /> : <C r={w / 2} h={0.03} at={[0, h - 0.03, 0]} m={wood} cast={s} seg={32} />}
          {shapeKey === "c" ? <><B s={[0.03, h, d * 0.9]} at={[x0, 0, -d * 0.45]} m={METAL_DARK} /><B s={[w * 0.9, 0.03, d * 0.9]} at={[x0, 0, -d * 0.45]} m={METAL_DARK} /></> : shapeKey === "square" ? legs4(x0, z0, w, d, h - 0.03, "taper", c, 0.02) : <C r={0.025} h={h - 0.03} at={[0, 0, 0]} m={wood} />}
          {shapeKey === "round" ? <C r={w * 0.35} h={0.02} at={[0, 0, 0]} m={wood} /> : null}
        </group>
      );
    }
    case "floor-lamp": {
      const shadeType = str(p, "shade", "drum");
      if (shadeType === "arc") {
        const segments = 8;
        return (
          <group>
            <C r={0.16} h={0.04} at={[x0 + 0.18, 0, 0]} m={{ color: "#d8d4cc", roughness: 0.3 }} />
            {Array.from({ length: segments }, (_, i) => {
              const t0 = i / segments;
              const a = t0 * Math.PI * 0.55;
              return <B key={i} s={[0.02, 0.32, 0.02]} at={[x0 + 0.17 + Math.sin(a) * (w - 0.45) * 0.95, Math.cos(a) * 0.2 + t0 * (h - 0.45), -0.01]} m={METAL_DARK} rot={[0, 0, -a]} />;
            })}
            <Lampshade shadeType="dome" r={0.18} hgt={0.18} at={[-x0 - 0.2, h - 0.3, 0]} c={c} glow={glow} />
          </group>
        );
      }
      const shadeH = 0.32;
      return (
        <group>
          <C r={Math.min(w, d) * 0.4} h={0.03} at={[0, 0, 0]} m={METAL_DARK} />
          <C r={0.012} h={h - shadeH} at={[0, 0.03, 0]} m={{ color: "#3e4441", metalness: 0.6, roughness: 0.4 }} seg={8} />
          <Lampshade shadeType={shadeType} r={Math.min(w, d) * 0.45} hgt={shadeH} at={[0, h - shadeH - (shadeType === "globe" ? 0.05 : 0), 0]} c={c} glow={glow} />
        </group>
      );
    }
    case "table-lamp": {
      const base = str(p, "base", "sphere");
      return (
        <group>
          {base === "sphere" ? <S r={w * 0.3} at={[0, w * 0.3, 0]} m={{ color: c, roughness: 0.3 }} detail={3} /> : base === "column" ? <C r={w * 0.15} h={h * 0.55} at={[0, 0, 0]} m={{ color: c, roughness: 0.3 }} /> : [0, 1, 2].map((i) => <B key={i} s={[0.012, h * 0.6, 0.012]} at={[Math.sin(i * 2.1) * w * 0.2, 0, Math.cos(i * 2.1) * w * 0.2]} m={{ color: shade(c, -0.3) }} rot={[0.2 * Math.cos(i * 2.1), 0, -0.2 * Math.sin(i * 2.1)]} />)}
          <C r={0.008} h={h * 0.15} at={[0, h * 0.5, 0]} m={HANDLE} />
          <Lampshade shadeType="drum" r={w * 0.5} hgt={h * 0.38} at={[0, h * 0.62, 0]} c="#f1ead9" glow={glow} />
        </group>
      );
    }
    case "desk-lamp": {
      if (str(p, "style", "arm") === "mushroom") return <group><C r={w * 0.35} r2={w * 0.4} h={0.03} at={[0, 0, 0]} m={{ color: c, roughness: 0.3 }} /><C r={0.02} h={h * 0.5} at={[0, 0.03, 0]} m={{ color: c, roughness: 0.3 }} /><S r={w * 0.5} at={[0, h * 0.62, 0]} m={{ color: c, roughness: 0.3, emissive: glow ? "#ffd59a" : undefined, emissiveIntensity: glow ? 0.5 : 0 }} scale={[1, 0.6, 1]} detail={3} /></group>;
      return (
        <group>
          <C r={w * 0.4} r2={w * 0.45} h={0.02} at={[0, 0, 0]} m={{ color: c, roughness: 0.4, metalness: 0.4 }} />
          <B s={[0.015, h * 0.55, 0.015]} at={[-0.008, 0.02, -0.008]} m={{ color: c, metalness: 0.4, roughness: 0.4 }} rot={[0.25, 0, 0]} />
          <B s={[0.015, h * 0.45, 0.015]} at={[-0.008, h * 0.5, 0.02]} m={{ color: c, metalness: 0.4, roughness: 0.4 }} rot={[-0.7, 0, 0]} />
          <C r={w * 0.18} r2={w * 0.42} h={h * 0.22} at={[0, h * 0.7, w * 0.25]} m={{ color: c, roughness: 0.4, emissive: glow ? "#ffd59a" : undefined, emissiveIntensity: glow ? 0.5 : 0 }} rot={[0.4, 0, 0]} />
        </group>
      );
    }
    case "pendant":
      return (
        <group>
          <C r={0.004} h={h - 0.25} at={[0, 0.25, 0]} m={METAL_DARK} seg={6} cast={false} />
          <C r={0.05} h={0.02} at={[0, h - 0.02, 0]} m={METAL_DARK} cast={false} />
          <Lampshade shadeType={str(p, "shade", "dome")} r={w / 2} hgt={0.25} at={[0, 0, 0]} c={c} glow={glow} />
        </group>
      );
    case "ceiling-light":
      return (
        <group>
          <C r={w * 0.12} h={h * 0.4} at={[0, h * 0.6, 0]} m={{ color: "#d6d2ca" }} cast={false} />
          <C r={w * 0.5} r2={w * 0.42} h={h * 0.6} at={[0, 0, 0]} m={{ color: c, emissive: glow ? "#fff1dc" : undefined, emissiveIntensity: glow ? 1.2 : 0 }} seg={40} cast={false} />
        </group>
      );
    case "rug": {
      const round = str(p, "shape", "rect") === "round";
      const pattern = str(p, "pattern", "plain");
      if (round) return <group><C r={w / 2} h={h} at={[0, 0, 0]} m={{ color: c, roughness: 1 }} seg={48} cast={false} /><C r={w / 2 - 0.12} h={h + 0.001} at={[0, 0, 0]} m={{ color: shade(c, -0.12), roughness: 1 }} seg={48} cast={false} /></group>;
      return (
        <group>
          <B s={[w, h, d]} at={[x0, 0, z0]} m={{ color: c, roughness: 1 }} cast={false} />
          {pattern === "border" ? <B s={[w - 0.2, h + 0.001, d - 0.2]} at={[x0 + 0.1, 0, z0 + 0.1]} m={{ color: shade(c, -0.14), roughness: 1 }} cast={false} /> : null}
          {pattern === "stripes" ? Array.from({ length: Math.floor(d / 0.3) }, (_, i) => <B key={i} s={[w, h + 0.001, 0.08]} at={[x0, 0, z0 + 0.12 + i * 0.3]} m={{ color: shade(c, -0.2), roughness: 1 }} cast={false} />) : null}
        </group>
      );
    }
    case "plant":
      return Plant(ctx);
    case "vase": {
      const vshape = str(p, "shape", "tall");
      const m: Mat = { color: c, roughness: 0.25 };
      if (vshape === "round") return <S r={w * 0.45} at={[0, h * 0.5, 0]} m={m} scale={[1, h / (w * 0.9), 1]} detail={3} />;
      if (vshape === "bottle") return <group><S r={w * 0.45} at={[0, w * 0.45, 0]} m={m} detail={3} /><C r={w * 0.1} h={h - w * 0.8} at={[0, w * 0.8, 0]} m={m} /></group>;
      return <group><C r={w * 0.32} r2={w * 0.45} h={h} at={[0, 0, 0]} m={m} seg={24} /><B s={[0.01, 0.25, 0.01]} at={[0, h - 0.05, 0]} m={{ color: "#6b7d3a" }} /></group>;
    }
    case "mirror": {
      const glass: Mat = { color: "#e3ebf0", metalness: 0.95, roughness: 0.06 };
      if (bool(p, "round")) return <group><C r={w / 2} h={d} at={[0, h / 2, -d / 2]} m={{ color: c, metalness: 0.6, roughness: 0.4 }} rot={[Math.PI / 2, 0, 0]} seg={40} /><C r={w / 2 - 0.03} h={0.005} at={[0, h / 2, d / 2 - 0.004]} m={glass} rot={[Math.PI / 2, 0, 0]} seg={40} /></group>;
      return <group><B s={[w, h, d * 0.6]} at={[x0, 0, z0]} m={{ color: c, metalness: 0.6, roughness: 0.4 }} cast={s} /><B s={[w - 0.05, h - 0.05, 0.005]} at={[x0 + 0.025, 0.025, z0 + d * 0.6]} m={glass} cast={false} /></group>;
    }
    case "curtains": {
      // Rod plus two gathered panels; each panel is a row of soft folds.
      const fabric: Mat = { color: c, roughness: 0.95 };
      const panel = w * 0.28;
      const folds = Math.max(4, Math.round(panel / 0.07));
      const fold = (side: number) => Array.from({ length: folds }, (_, index) => (
        <C key={side + ":" + index} r={panel / folds / 1.6} h={h - 0.08} at={[side * (w / 2 - panel / 2) + (index - (folds - 1) / 2) * (panel / folds), 0.02, (index % 2 ? 0.015 : -0.015)]} m={fabric} seg={10} />
      ));
      return (
        <group>
          <C r={0.012} h={w + 0.1} at={[0, h - 0.03 - (w + 0.1) / 2, -d / 2 + 0.02]} m={METAL_DARK} rot={[0, 0, -Math.PI / 2]} />
          {fold(-1)}
          {fold(1)}
        </group>
      );
    }
    case "artwork":
      return (
        <group>
          <B s={[w, h, d]} at={[x0, 0, z0]} m={{ color: "#2d2a26", roughness: 0.5 }} />
          <B s={[w - 0.06, h - 0.06, 0.005]} at={[x0 + 0.03, 0.03, -z0]} m={{ color: c, roughness: 0.9 }} cast={false} />
          <B s={(w - 0.06) * 0.5 > 0 ? [(w - 0.06) * 0.45, (h - 0.06) * 0.5, 0.006] : [0.1, 0.1, 0.006]} at={[x0 + 0.08, 0.1, -z0]} m={{ color: str(p, "a", "#3f6c8f"), roughness: 0.9 }} cast={false} />
          <S r={Math.min(w, h) * 0.15} at={[w * 0.18, h * 0.62, -z0 + 0.004]} m={{ color: str(p, "b", "#e8d8b0") }} scale={[1, 1, 0.05]} detail={2} />
        </group>
      );
    case "tv":
    case "monitor": {
      const screenH = family === "tv" ? h - 0.08 : h * 0.7;
      return (
        <group>
          <B s={[w, screenH, 0.04]} at={[x0, h - screenH, -0.02]} m={{ color: "#141516", roughness: 0.3, metalness: 0.3 }} cast={s} />
          <B s={[w - 0.02, screenH - 0.02, 0.005]} at={[x0 + 0.01, h - screenH + 0.01, 0.02]} m={{ color: "#1f2a36", roughness: 0.1, metalness: 0.2, emissive: "#0d1520", emissiveIntensity: 0.4 }} cast={false} />
          <B s={[0.05, h - screenH, 0.04]} at={[-0.025, 0, -0.02]} m={METAL_DARK} />
          <B s={[family === "tv" ? w * 0.5 : w * 0.35, 0.015, d * 0.8]} at={[family === "tv" ? -w * 0.25 : -w * 0.175, 0, -d * 0.4]} m={METAL_DARK} />
        </group>
      );
    }
    case "kitchen-counter":
    case "sink-cabinet":
    case "kitchen-island": {
      const top = str(p, "top", "#d9d4cb");
      const island = family === "kitchen-island";
      const doors = Math.max(2, Math.round(w / 0.6));
      const parts: ReactNode[] = [
        <B key="body" s={[w - (island ? 0.3 : 0), h - 0.04 - 0.1, d - (island ? 0.3 : 0.04)]} at={[x0 + (island ? 0.15 : 0), 0.1, z0 + (island ? 0.15 : 0)]} m={{ color: c, roughness: 0.5 }} cast={s} />,
        <B key="kick" s={[w - (island ? 0.3 : 0.04), 0.1, d - (island ? 0.35 : 0.1)]} at={[x0 + (island ? 0.15 : 0.02), 0, z0 + (island ? 0.15 : 0.03)]} m={{ color: "#2e2e2e" }} cast={false} />,
        <B key="top" s={[w, 0.04, d]} at={[x0, h - 0.04, z0]} m={{ color: top, roughness: 0.25 }} cast={s} />,
      ];
      for (let i = 0; i < doors; i += 1) {
        const dw = (w - (island ? 0.3 : 0)) / doors;
        const fx = x0 + (island ? 0.15 : 0) + i * dw;
        parts.push(<B key={"door" + i} s={[dw - 0.01, h - 0.2, 0.02]} at={[fx + 0.005, 0.12, -z0 - (island ? 0.15 : 0.02)]} m={{ color: shade(c, 0.06), roughness: 0.45 }} cast={false} />);
        parts.push(<B key={"h" + i} s={[0.12, 0.012, 0.02]} at={[fx + dw / 2 - 0.06, h - 0.16, -z0 - (island ? 0.15 : 0)]} m={HANDLE} cast={false} />);
      }
      if (family === "sink-cabinet") {
        const basins = bool(p, "double") ? 2 : 1;
        for (let i = 0; i < basins; i += 1) parts.push(<B key={"basin" + i} s={[0.4, 0.012, 0.36]} at={[x0 + (w - basins * 0.44) / 2 + i * 0.44, h - 0.002, -0.2]} m={{ color: "#9aa0a6", metalness: 0.8, roughness: 0.25 }} cast={false} />);
        parts.push(<C key="tap" r={0.012} h={0.25} at={[0, h, -0.25]} m={{ color: "#c0c4c8", metalness: 0.9, roughness: 0.2 }} />);
      }
      return <group>{parts}</group>;
    }
    case "fridge": {
      const metal: Mat = { color: c, metalness: c === "#c7cacd" ? 0.7 : 0.1, roughness: 0.3 };
      const french = bool(p, "french");
      return (
        <group>
          <B s={[w, h, d - 0.03]} at={[x0, 0, z0]} m={metal} cast={s} />
          {french
            ? <><B s={[w / 2 - 0.01, h * 0.62, 0.03]} at={[x0, h * 0.37, -z0 - 0.03]} m={metal} cast={false} /><B s={[w / 2 - 0.01, h * 0.62, 0.03]} at={[0.005, h * 0.37, -z0 - 0.03]} m={metal} cast={false} /><B s={[w, h * 0.34, 0.03]} at={[x0, 0.01, -z0 - 0.03]} m={metal} cast={false} /></>
            : <><B s={[w, h * 0.66, 0.03]} at={[x0, h * 0.33, -z0 - 0.03]} m={metal} cast={false} /><B s={[w, h * 0.32, 0.03]} at={[x0, 0, -z0 - 0.03]} m={metal} cast={false} /></>}
          {(french ? [-0.04, 0.02] : [x0 + 0.06]).map((x, i) => <B key={i} s={[0.02, h * 0.3, 0.03]} at={[x, h * 0.55, -z0]} m={HANDLE} cast={false} />)}
        </group>
      );
    }
    case "stove":
      return (
        <group>
          <B s={[w, h - 0.03, d]} at={[x0, 0, z0]} m={{ color: c, metalness: 0.6, roughness: 0.35 }} cast={s} />
          <B s={[w, 0.03, d]} at={[x0, h - 0.03, z0]} m={{ color: "#1d1d1f", roughness: 0.2 }} cast={s} />
          {[[-0.25, -0.15], [0.25, -0.15], [-0.25, 0.15], [0.25, 0.15]].map(([fx, fz], i) => <C key={i} r={0.07} h={0.01} at={[fx! * w, h, fz! * d]} m={{ color: "#3a3a3c" }} seg={20} cast={false} />)}
          <B s={[w - 0.08, h * 0.5, 0.02]} at={[x0 + 0.04, 0.1, -z0]} m={{ color: "#1d1d1f", roughness: 0.15 }} cast={false} />
          <B s={[w - 0.2, 0.02, 0.03]} at={[x0 + 0.1, h * 0.65, -z0]} m={HANDLE} cast={false} />
        </group>
      );
    case "toilet": {
      const wall = bool(p, "wall");
      const ceramic: Mat = { color: c, roughness: 0.2 };
      return (
        <group>
          <B s={[w, wall ? 0.38 : h, 0.18]} at={[x0, wall ? h - 0.38 : 0, z0]} m={ceramic} cast={s} />
          <C r={w * 0.48} r2={w * 0.36} h={0.38} at={[0, wall ? 0.06 : 0, -z0 - w * 0.62]} m={ceramic} seg={24} />
          <C r={w * 0.5} h={0.03} at={[0, 0.42, -z0 - w * 0.62]} m={{ color: shade(c, -0.04), roughness: 0.3 }} seg={24} />
          {wall ? null : <B s={[w * 0.6, 0.38, d - 0.4]} at={[-w * 0.3, 0, z0 + 0.15]} m={ceramic} />}
        </group>
      );
    }
    case "vanity": {
      const basins = num(p, "basins", 1);
      return (
        <group>
          {Case({ ...ctx, h: h - 0.05, p: { base: "float", doors: Math.max(2, basins * 2) } }, "doors")}
          <B s={[w, 0.05, d]} at={[x0, h - 0.05, z0]} m={{ color: "#efefed", roughness: 0.2 }} cast={s} />
          {Array.from({ length: basins }, (_, i) => <C key={i} r={0.17} r2={0.13} h={0.13} at={[x0 + (w / (basins + 1)) * (i + 1), h, 0.02]} m={{ color: "#ffffff", roughness: 0.15 }} seg={28} />)}
          <C r={0.012} h={0.22} at={[0, h, z0 + 0.06]} m={{ color: "#c0c4c8", metalness: 0.9, roughness: 0.2 }} />
        </group>
      );
    }
    case "bathtub": {
      const free = bool(p, "freestanding");
      const enamel: Mat = { color: c, roughness: 0.15 };
      return (
        <group>
          {free ? <S r={0.5} at={[0, h * 0.5, 0]} m={enamel} scale={[w, h * 1.9, d * 1.9 * 0.5 + 0.0]} detail={3} /> : <B s={[w, h, d]} at={[x0, 0, z0]} m={enamel} cast={s} />}
          <B s={[w - 0.16, 0.01, d - 0.16]} at={[x0 + 0.08, h - 0.12, z0 + 0.08]} m={{ color: "#bcdde8", roughness: 0.05, transparent: true, opacity: 0.75 }} cast={false} />
          <C r={0.015} h={0.2} at={[x0 + 0.1, h, 0]} m={{ color: "#c0c4c8", metalness: 0.9, roughness: 0.2 }} />
        </group>
      );
    }
    case "shower":
      return (
        <group>
          <B s={[w, 0.05, d]} at={[x0, 0, z0]} m={{ color: "#f2f2f0", roughness: 0.2 }} cast={false} />
          <B s={[0.01, h - 0.05, d]} at={[-x0 - 0.01, 0.05, z0]} m={{ color: "#d6eef4", roughness: 0.02, transparent: true, opacity: 0.25 }} cast={false} />
          <B s={[w * 0.6, h - 0.05, 0.01]} at={[x0 + w * 0.4, 0.05, -z0 - 0.01]} m={{ color: "#d6eef4", roughness: 0.02, transparent: true, opacity: 0.25 }} cast={false} />
          <C r={0.012} h={h - 0.2} at={[0, 0.05, z0 + 0.04]} m={{ color: "#c0c4c8", metalness: 0.9, roughness: 0.2 }} />
          <C r={0.1} h={0.02} at={[0, h - 0.18, z0 + 0.14]} m={{ color: "#c0c4c8", metalness: 0.9, roughness: 0.2 }} />
        </group>
      );
    case "lounger":
      return (
        <group>
          {legs4(x0, z0, w, d, 0.25, "taper", c, 0.04)}
          <B s={[w, 0.06, d * 0.68]} at={[x0, 0.25, -z0 - d * 0.68]} m={wood} cast={s} />
          <B s={[w, 0.06, d * 0.36]} at={[x0, 0.4, z0 + 0.03]} m={wood} cast={s} rot={[-0.6, 0, 0]} />
          <B s={[w - 0.06, 0.06, d * 0.66]} at={[x0 + 0.03, 0.31, -z0 - d * 0.67]} m={{ color: str(p, "cushion", "#e8e1d2"), roughness: 1 }} cast={s} />
        </group>
      );
    case "parasol":
      return (
        <group>
          <C r={0.25} h={0.08} at={[0, 0, 0]} m={{ color: "#5a5a5a" }} />
          <C r={0.02} h={h - 0.3} at={[0, 0.08, 0]} m={{ color: "#c8b28a" }} seg={8} />
          <C r={0.02} r2={w / 2} h={0.35} at={[0, h - 0.4, 0]} m={{ color: c, roughness: 0.9 }} seg={8} />
        </group>
      );
    case "door":
    case "window":
      return <B s={[w, h, d]} at={[x0, 0, z0]} m={{ color: c, transparent: family === "window", opacity: family === "window" ? 0.5 : 1 }} />;
    default:
      return <B s={[w, h, d]} at={[x0, 0, z0]} m={{ color: c }} cast={s} />;
  }
}
