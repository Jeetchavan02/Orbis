import { useEffect, useLayoutEffect, useState } from "react";
import { advance, createRoot, extend, useThree, type ReconcilerRoot } from "@react-three/fiber";
import * as THREE from "three";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";

// <Canvas> registers the THREE catalogue on mount; pages without one (the homepage) must do it here.
extend(THREE as unknown as Parameters<typeof extend>[0]);
import type { FurnitureObject } from "@reality-builder/shared";
import type { CatalogItem } from "../data/catalog";
import { FurnitureModel } from "../components/viewport/FurnitureModel";

const SIZE = 160;
const cache = new Map<string, string>();
const waiting = new Map<string, ((url: string) => void)[]>();
const queue: CatalogItem[] = [];
let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let canvas: HTMLCanvasElement | null = null;
let busy = false;

function ThumbScene({ entry, onReady }: { entry: CatalogItem; onReady: () => void }) {
  const { camera } = useThree();
  const { width, depth, height } = entry.dimensions;
  const item: FurnitureObject = {
    id: "thumb", roomId: "thumb", name: entry.name, category: entry.category, catalogItemId: entry.id,
    position: { x: 0, y: 0, z: 0 }, yawDegrees: 0, dimensions: entry.dimensions, color: entry.color, version: 1,
  };
  useLayoutEffect(() => {
    // Three-quarter front view framing the whole object.
    const radius = Math.max(width, depth, height) * 0.85 + 0.05;
    camera.position.set(radius * 1.25, height * 0.5 + radius * 0.95, radius * 1.6);
    camera.lookAt(0, height * 0.42, 0);
    camera.updateProjectionMatrix();
    onReady();
  });
  return (
    <>
      <hemisphereLight args={["#ffffff", "#c7c0b5", 1.4]} />
      <directionalLight position={[3, 6, 4]} intensity={2.2} />
      <directionalLight position={[-4, 3, -2]} intensity={0.6} />
      <FurnitureModel item={item} lowDetail={false} castShadow={false} lightOn={!!entry.light} />
    </>
  );
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const entry = queue.shift()!;
      if (cache.has(entry.id)) continue;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        root = createRoot(canvas);
        await root.configure({
          gl: { preserveDrawingBuffer: true, antialias: true, alpha: true },
          camera: { fov: 32, near: 0.01, far: 100 },
          size: { width: SIZE, height: SIZE, top: 0, left: 0 },
          frameloop: "never",
          dpr: 1,
          onCreated: ({ gl }) => {
            gl.toneMapping = ACESFilmicToneMapping;
            gl.outputColorSpace = SRGBColorSpace;
          },
        });
      }
      await new Promise<void>((resolve) => root!.render(<ThumbScene key={entry.id} entry={entry} onReady={resolve} />));
      advance(performance.now());
      const url = canvas.toDataURL("image/png");
      cache.set(entry.id, url);
      waiting.get(entry.id)?.forEach((callback) => callback(url));
      waiting.delete(entry.id);
      // Yield so thumbnail rendering never blocks interaction.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    console.error("Thumbnail rendering failed", error);
  } finally {
    busy = false;
  }
}

function request(entry: CatalogItem, callback: (url: string) => void) {
  const hit = cache.get(entry.id);
  if (hit) return callback(hit);
  waiting.set(entry.id, [...(waiting.get(entry.id) ?? []), callback]);
  if (!queue.some((queued) => queued.id === entry.id)) queue.push(entry);
  void pump();
}

/** Real 3D thumbnail of the exact catalog model, rendered lazily when the card becomes visible. */
export function useThumbnail(entry: CatalogItem, element: HTMLElement | null) {
  const [url, setUrl] = useState(() => cache.get(entry.id) ?? null);
  useEffect(() => {
    if (url || !element) return;
    let active = true;
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) {
        observer.disconnect();
        request(entry, (result) => active && setUrl(result));
      }
    }, { rootMargin: "120px" });
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [entry, element, url]);
  return url;
}
