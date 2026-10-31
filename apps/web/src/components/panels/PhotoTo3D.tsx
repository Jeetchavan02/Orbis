import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Wand2, X } from "lucide-react";
import type { FurnitureObject } from "@reality-builder/shared";
import type { CatalogItem } from "../../data/catalog";
import { loadImage, removeBackground, type Cutout } from "../../lib/cutout";
import { activeRoom, freeSpot } from "../../lib/placement";
import { usePhotoDialog } from "../../lib/ui";
import { newEntityId, useWorkspaceStore } from "../../store/workspace";

/** catalogItemId prefix marking a furniture object rendered from an uploaded photo cutout. */
export const CUTOUT_PREFIX = "cutout:";

/**
 * Photo → 3D: upload a photo, remove its background to transparency, then place it in the room as a
 * standing textured object with real dimensions (so it collides and validates like any other item).
 */
export function PhotoTo3DDialog() {
  const open = usePhotoDialog((state) => state.open);
  const setOpen = usePhotoDialog((state) => state.setOpen);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [tolerance, setTolerance] = useState(40);
  const [cutout, setCutout] = useState<Cutout | null>(null);
  const [name, setName] = useState("");
  const [height, setHeight] = useState(1);
  const [depth, setDepth] = useState(0.4);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setImage(null);
      setCutout(null);
      setBusy(false);
    }
  }, [open]);
  useEffect(() => {
    if (image) setCutout(removeBackground(image, tolerance));
  }, [image, tolerance]);
  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.src);
  }, [image]);
  if (!open) return null;

  const width = cutout ? Math.round((height * cutout.width / cutout.height) * 100) / 100 : 0;

  const pick = async (file: File) => {
    try {
      setImage(await loadImage(file));
      const base = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
      setFileName(file.name);
      setName(base ? base[0]!.toUpperCase() + base.slice(1) : "Photo object");
    } catch {
      useWorkspaceStore.getState().notify("error", `${file.name} could not be read as an image.`);
    }
  };

  const add = async () => {
    if (!cutout) return;
    const { scene, dispatch, selectEntity, notify } = useWorkspaceStore.getState();
    const room = activeRoom(scene);
    if (!room) return;
    setBusy(true);
    try {
      const response = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: cutout.dataUrl }) });
      const body = await response.json() as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Upload failed.");
      const dimensions = { width, depth, height };
      const probe = { id: "photo", name, category: "other", group: "basic", family: "box", dimensions, color: "#ffffff", params: {}, rooms: [] } as unknown as CatalogItem;
      const pose = freeSpot(probe, room, scene);
      const furniture: FurnitureObject = {
        id: newEntityId("obj"), roomId: room.id, name: name.trim() || "Photo object", category: "other",
        catalogItemId: CUTOUT_PREFIX + body.id, position: { x: pose.x, y: room.position.y, z: pose.z }, yawDegrees: pose.yaw,
        dimensions, color: "#ffffff", version: 1,
      };
      if (dispatch({ type: "furniture.create", furniture }, { label: "Add " + furniture.name })) {
        selectEntity(furniture.id);
        notify("success", `${furniture.name} added from photo (${width.toFixed(2)} × ${depth.toFixed(2)} × ${height.toFixed(2)} m).`);
        setOpen(false);
      }
    } catch (error) {
      notify("error", "Photo → 3D failed: " + (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="photo3d-title" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div className="modal photo3d">
        <button type="button" className="icon-button photo3d-close" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
        <h2 id="photo3d-title"><Wand2 size={18} /> Photo → 3D</h2>
        <p className="field-note">Upload a photo of a piece of furniture or decor. The background is removed in your browser and the cutout is placed in the room at the size you set. Plain, evenly lit backgrounds work best.</p>

        <div className="photo3d-panes">
          <button type="button" className="photo3d-pane" onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void pick(file); }}>
            {image ? <img src={image.src} alt="Original" /> : <span className="photo3d-empty"><ImagePlus size={28} /> Click or drop a photo</span>}
            <span className="photo3d-caption">{image ? fileName : "Original"}</span>
          </button>
          <div className="photo3d-pane photo3d-pane--checker">
            {cutout ? <img src={cutout.dataUrl} alt="Background removed" /> : <span className="photo3d-empty">Transparent cutout</span>}
            <span className="photo3d-caption">Background removed</span>
          </div>
        </div>

        {image ? (
          <>
            <label className="photo3d-row">
              <span>Background tolerance <small>{tolerance}</small></span>
              <input type="range" min={5} max={120} value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} />
            </label>
            {cutout && cutout.coverage < 0.02 ? <p className="field-note warn">Almost everything was removed — lower the tolerance.</p> : null}
            {cutout && cutout.coverage > 0.97 ? <p className="field-note warn">The background wasn't detected — raise the tolerance or use a photo on a plain background.</p> : null}
            <div className="photo3d-fields">
              <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label><span>Height (m)</span><input type="number" min={0.05} max={4} step={0.05} value={height} onChange={(event) => setHeight(Math.max(0.05, Number(event.target.value) || 0.05))} /></label>
              <label><span>Depth (m)</span><input type="number" min={0.02} max={4} step={0.05} value={depth} onChange={(event) => setDepth(Math.max(0.02, Number(event.target.value) || 0.02))} /></label>
              <label><span>Width (m)</span><input value={width.toFixed(2)} readOnly title="From the photo's proportions and the height" /></label>
            </div>
          </>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="primary-button" disabled={!cutout || cutout.coverage < 0.02 || busy} onClick={() => void add()}>
            {busy ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Add to room
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void pick(file); }} />
      </div>
    </div>
  );
}
