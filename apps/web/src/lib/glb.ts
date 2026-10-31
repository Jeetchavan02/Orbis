import { Box3, BufferGeometry, Mesh, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { normalizeMesh, type MeshData } from "@reality-builder/shared";

const MAX_VERTICES = 60_000;

export type ImportedModel = { mesh: MeshData; name: string; scaledFrom: number | null; triangles: number };

/**
 * Parses a GLB/GLTF file and bakes all of its meshes (with their world transforms) into one local-space
 * triangle mesh, so imported models participate in collisions, editing, persistence and collaboration
 * exactly like built-in objects. Materials/textures are not kept (a single material color is used).
 */
export async function importModelFile(file: File): Promise<ImportedModel> {
  const isGlb = file.name.toLowerCase().endsWith(".glb");
  if (!isGlb && !file.name.toLowerCase().endsWith(".gltf")) throw new Error("Choose a .glb or .gltf file.");
  const loader = new GLTFLoader();
  const data = isGlb ? await file.arrayBuffer() : await file.text();
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["parseAsync"]>>>((resolve, reject) =>
    loader.parse(data, "", resolve, (error) => reject(new Error("Could not read the model: " + (error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error))))),
  );

  gltf.scene.updateMatrixWorld(true);
  const positions: number[] = [];
  const indices: number[] = [];
  gltf.scene.traverse((object) => {
    if (!(object as Mesh).isMesh) return;
    const geometry = ((object as Mesh).geometry as BufferGeometry).clone();
    geometry.applyMatrix4(object.matrixWorld);
    const attribute = geometry.getAttribute("position");
    const offset = positions.length / 3;
    for (let i = 0; i < attribute.count; i += 1) positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i += 1) indices.push(offset + geometry.index.getX(i));
    } else {
      for (let i = 0; i < attribute.count; i += 1) indices.push(offset + i);
    }
    geometry.dispose();
  });
  if (positions.length === 0) throw new Error("The file does not contain any meshes.");
  if (positions.length / 3 > MAX_VERTICES) {
    throw new Error(`The model has ${(positions.length / 3).toLocaleString()} vertices; the limit is ${MAX_VERTICES.toLocaleString()}. Simplify it first.`);
  }

  // Models authored in centimeters or very large units are scaled so the longest side is 1 m.
  const box = new Box3().setFromArray(positions);
  const size = box.getSize(new Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  let scaledFrom: number | null = null;
  if (longest > 12 || longest < 0.05) {
    scaledFrom = longest;
    const factor = 1 / longest;
    for (let i = 0; i < positions.length; i += 1) positions[i] = positions[i]! * factor;
  }

  const normalized = normalizeMesh({ positions: positions.map((value) => Math.round(value * 1e5) / 1e5), indices, source: "imported" });
  return { mesh: normalized.mesh, name: file.name.replace(/\.(glb|gltf)$/i, ""), scaledFrom, triangles: indices.length / 3 };
}
