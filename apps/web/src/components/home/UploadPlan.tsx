import { useEffect, useRef, useState } from "react";
import { openProject } from "../../lib/project";
import { ArrowLeft, Check, CircleAlert, DoorOpen, FileImage, ImageUp, Loader2, RefreshCw, Sofa, Trash2, Upload, X } from "lucide-react";
import {
  AiImageResponseSchema, AiPlanAnalyzeResponseSchema,
  type AiCatalogItem, type AiImageResponse, type AiPlanAnalyzeResponse, type PlanBuildSettings, type Scene,
} from "@reality-builder/shared";
import { catalog } from "../../data/catalog";

const aiCatalog: AiCatalogItem[] = catalog.filter((entry) => entry.id !== "box").map((entry) => ({ ...entry }));
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const STEPS = ["Analysing room plan", "Detecting walls and openings", "Estimating room dimensions", "Matching furniture to the library"];
const FT = 0.3048;

type Picked = { name: string; preview: string; base64: string };
type Units = "m" | "ft";

async function encodeImage(file: File): Promise<Picked> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { name: file.name, base64: dataUrl.split(",")[1]!, preview: dataUrl };
}

async function post<T>(url: string, body: unknown, schema: { parse: (value: unknown) => T }) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `Request failed (${response.status})`);
  return schema.parse(payload);
}

/** A small line-drawn plan used for the good/bad examples. */
function PlanSketch() {
  return (
    <svg viewBox="0 0 160 110" aria-hidden="true">
      <rect x="1" y="1" width="158" height="108" fill="#fff" />
      <g fill="none" stroke="#3a3550" strokeWidth="3"><path d="M18 14h124v82H18z" /></g>
      <g fill="none" stroke="#8a86a0" strokeWidth="1.2">
        <path d="M18 6h124M18 3v6M142 3v6M150 14v82M147 14h6M147 96h6" />
        <path d="M28 70h34v22H28zM28 70v-6h34v6" /><path d="M104 20h32v14h-32z" /><path d="M64 96a12 12 0 0 1 12-12" />
      </g>
      <path d="M110 14h22" stroke="#7c4dff" strokeWidth="3" />
      <g fill="#8a86a0" fontSize="6" fontFamily="sans-serif" textAnchor="middle"><text x="80" y="5">4.2 m</text><text x="45" y="62">Bed</text><text x="120" y="45">Desk</text></g>
    </svg>
  );
}

/** Top-down preview of the built room: walls, openings and furniture footprints. */
function RoomPreview({ scene }: { scene: Scene }) {
  const room = scene.rooms[0]!;
  const { width: w, depth: d, wallThickness: t } = room.dimensions;
  const pad = 0.6;
  return (
    <svg className="up-plan-svg" viewBox={`${-w / 2 - t - pad} ${-d / 2 - t - pad} ${w + 2 * (t + pad)} ${d + 2 * (t + pad)}`} role="img" aria-label="Top view of the generated room">
      <rect x={-w / 2 - t} y={-d / 2 - t} width={w + 2 * t} height={d + 2 * t} fill="#3a3550" />
      <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={room.floorColor} />
      {room.openings.map((opening) => {
        const horizontal = opening.wall === "north" || opening.wall === "south";
        const sign = opening.wall === "north" || opening.wall === "west" ? -1 : 1;
        const along = opening.offset - opening.width / 2;
        const fill = opening.kind === "door" ? room.floorColor : "#b9dcf5";
        return horizontal
          ? <rect key={opening.id} x={along} y={sign * (d / 2) + (sign < 0 ? -t : 0)} width={opening.width} height={t} fill={fill} />
          : <rect key={opening.id} x={sign * (w / 2) + (sign < 0 ? -t : 0)} y={along} width={t} height={opening.width} fill={fill} />;
      })}
      {scene.furniture.map((item) => (
        <g key={item.id} transform={`translate(${item.position.x} ${item.position.z}) rotate(${-item.yawDegrees})`}>
          <rect x={-item.dimensions.width / 2} y={-item.dimensions.depth / 2} width={item.dimensions.width} height={item.dimensions.depth} rx={0.04} fill={item.color} stroke="#fff" strokeWidth={0.03} opacity={0.92} />
        </g>
      ))}
    </svg>
  );
}

function NumberField({ label, meters, units, min, max, onChange, tag }: { label: string; meters: number; units: Units; min: number; max: number; onChange: (meters: number) => void; tag?: "written" | "estimated" }) {
  const factor = units === "ft" ? FT : 1;
  const [text, setText] = useState((meters / factor).toFixed(2));
  useEffect(() => setText((meters / factor).toFixed(2)), [meters, factor]);
  const commit = () => {
    const value = Number(text) * factor;
    if (Number.isFinite(value) && value >= min && value <= max) onChange(Math.round(value * 100) / 100);
    else setText((meters / factor).toFixed(2));
  };
  return (
    <label className="up-field">
      <span>{label}{tag ? <em className={"up-tag up-tag--" + tag}>{tag === "written" ? "from plan" : "estimated"}</em> : null}</span>
      <span className="up-input"><input inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && commit()} /><small>{units}</small></span>
    </label>
  );
}

function confidenceLabel(value: number) {
  return value >= 0.8 ? "clear" : value >= 0.55 ? "likely" : "unsure";
}

export function UploadPlan({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<Picked | null>(null);
  const [phase, setPhase] = useState<"upload" | "analysing" | "review">("upload");
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<AiPlanAnalyzeResponse | null>(null);
  const [settings, setSettings] = useState<PlanBuildSettings | null>(null);
  const [built, setBuilt] = useState<AiImageResponse | null>(null);
  const [building, setBuilding] = useState(false);
  const [units, setUnits] = useState<Units>("m");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (picked: File) => {
    setFocus(undefined);
    if (!ACCEPT.includes(picked.type)) return setError("Please upload a PNG, JPG or WebP image of the room plan.");
    setError(null);
    setAnalysis(null);
    setBuilt(null);
    setPhase("upload");
    setFile(await encodeImage(picked));
    if (input.current) input.current.value = "";
  };

  const [focus, setFocus] = useState<string | undefined>();
  const analyse = async (focusRoom?: string) => {
    if (!file) return;
    setFocus(focusRoom);
    setError(null);
    setPhase("analysing");
    setStep(0);
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, STEPS.length - 1)), 3500);
    try {
      const result = await post("/api/ai/plan/analyze", { imageBase64: file.base64, mimeType: "image/jpeg", catalog: aiCatalog, focusRoom }, AiPlanAnalyzeResponseSchema);
      if (!result.extraction.isRoomPlan) {
        setPhase("upload");
        setError("This image doesn't look like a room plan or sketch. Try a top-down plan with the walls visible.");
        return;
      }
      const { extraction } = result;
      setAnalysis(result);
      setSettings({ width: extraction.width, depth: extraction.depth, height: extraction.height, wallThickness: 0.14, openings: true, furniture: true, lighting: "natural" });
      setPhase("review");
    } catch (failure) {
      setPhase("upload");
      setError((failure as Error).message);
    } finally {
      window.clearInterval(timer);
    }
  };

  // Rebuild the preview whenever a setting changes (deterministic, no AI call).
  useEffect(() => {
    if (!analysis || !settings) return;
    let live = true;
    setBuilding(true);
    const timer = window.setTimeout(() => {
      post("/api/ai/plan/build", { extraction: analysis.extraction, settings, catalog: aiCatalog }, AiImageResponseSchema)
        .then((result) => live && setBuilt(result))
        .catch((failure) => live && setError((failure as Error).message))
        .finally(() => live && setBuilding(false));
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [analysis, settings]);

  const openInEditor = async () => {
    if (!built) return;
    setOpening(true);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: built.scene.name, roomType: "bedroom", scene: built.scene }) });
      const body = (await response.json()) as { id?: string; ownerKey?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Could not create the project.");
      openProject(body.id, body.ownerKey);
    } catch (failure) {
      setError((failure as Error).message);
      setOpening(false);
    }
  };

  const remove = () => { setFocus(undefined); setFile(null); setAnalysis(null); setBuilt(null); setError(null); setPhase("upload"); };
  const set = (patch: Partial<PlanBuildSettings>) => setSettings((value) => (value ? { ...value, ...patch } : value));
  const extraction = analysis?.extraction;

  return (
    <div className="upload-plan">
      <header className="up-top">
        <button type="button" className="up-back" onClick={onBack}><ArrowLeft size={17} /> Back</button>
        <strong>Upload your room plan</strong>
        <span />
      </header>

      {phase === "review" && extraction && settings ? (
        <div className="up-review">
          <section className="up-pane">
            <div className="up-pane-head">
              <h2>{extraction.roomName}</h2>
              <button type="button" className="ghost-button" onClick={() => void analyse(focus)}><RefreshCw size={14} /> Regenerate</button>
            </div>
            {extraction.planRooms.length > 1 ? (
              <div className="up-rooms">
                <span>This plan has {extraction.planRooms.length} rooms. Reconstruct:</span>
                <div className="up-room-chips">
                  {extraction.planRooms.map((room) => (
                    <button key={room.name + room.label} type="button" className={room.name.toLowerCase() === extraction.roomName.toLowerCase() && (!room.label || extraction.measurements.some((entry) => entry.label === room.label)) ? "active" : ""} onClick={() => void analyse(room.label ? `${room.name} (${room.label})` : room.name)}>
                      {room.name}{room.label ? <small>{room.label}</small> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="up-compare">
              <figure><img src={file?.preview} alt="Uploaded plan" /><figcaption>Your plan</figcaption></figure>
              <figure className={building ? "is-building" : ""}>
                {built ? <RoomPreview scene={built.scene} /> : <div className="up-plan-svg" />}
                {building ? <span className="up-building"><Loader2 size={18} className="spin" /></span> : null}
                <figcaption>Generated room · top view</figcaption>
              </figure>
            </div>
            {built ? (
              <div className="up-stats">
                <span><strong>{(settings.width * settings.depth).toFixed(1)}</strong> m²</span>
                <span><strong>{built.scene.rooms[0]!.openings.length}</strong> doors & windows</span>
                <span><strong>{built.scene.furniture.length}</strong> objects</span>
                <span><strong>{built.issues.length}</strong> {built.issues.length === 1 ? "issue" : "issues"}</span>
              </div>
            ) : null}
            <details className="up-detected">
              <summary>What was detected ({extraction.openings.length + extraction.objects.length})</summary>
              <ul>
                {extraction.openings.map((item, index) => <li key={"o" + index}><DoorOpen size={14} /> {item.kind === "door" ? "Door" : "Window"} · {item.wall} wall · {item.width.toFixed(2)} m <em className={"up-conf up-conf--" + confidenceLabel(item.confidence)}>{confidenceLabel(item.confidence)}</em></li>)}
                {extraction.objects.map((item, index) => <li key={"f" + index}><Sofa size={14} /> {item.name || item.catalogItemId} <em className={"up-conf up-conf--" + confidenceLabel(item.confidence)}>{confidenceLabel(item.confidence)}</em></li>)}
                {!extraction.openings.length && !extraction.objects.length ? <li>Only the room outline was found.</li> : null}
              </ul>
              {extraction.notes ? <p className="up-notes">{extraction.notes}</p> : null}
            </details>
          </section>

          <aside className="up-settings">
            <div className="up-settings-head">
              <h3>Room settings</h3>
              <div className="segmented segmented--sm">
                <button type="button" className={units === "m" ? "active" : ""} onClick={() => setUnits("m")}>m</button>
                <button type="button" className={units === "ft" ? "active" : ""} onClick={() => setUnits("ft")}>ft</button>
              </div>
            </div>
            {analysis.sources.width === "estimated" || analysis.sources.depth === "estimated" ? <p className="up-warn"><CircleAlert size={14} /> No size was written for every side, so some measurements are approximate. Correct them below.</p> : null}
            <div className="up-grid2">
              <NumberField label="Width" meters={settings.width} units={units} min={1} max={40} tag={analysis.sources.width} onChange={(width) => set({ width })} />
              <NumberField label="Length" meters={settings.depth} units={units} min={1} max={40} tag={analysis.sources.depth} onChange={(depth) => set({ depth })} />
              <NumberField label="Wall height" meters={settings.height} units={units} min={2} max={6} onChange={(height) => set({ height })} />
              <NumberField label="Wall thickness" meters={settings.wallThickness} units={units} min={0.05} max={0.6} onChange={(wallThickness) => set({ wallThickness })} />
            </div>
            <label className="up-switch"><input type="checkbox" checked={settings.openings} onChange={(event) => set({ openings: event.target.checked })} /><span>Doors &amp; windows</span></label>
            <label className="up-switch"><input type="checkbox" checked={settings.furniture} onChange={(event) => set({ furniture: event.target.checked })} /><span>Furniture from the plan</span></label>
            <div className="up-field"><span>Lighting</span>
              <div className="segmented">
                {(["natural", "warm", "neutral"] as const).map((mode) => <button key={mode} type="button" className={settings.lighting === mode ? "active" : ""} onClick={() => set({ lighting: mode })}>{mode[0]!.toUpperCase() + mode.slice(1)}</button>)}
              </div>
            </div>
            {error ? <p className="issue-inline issue-inline--error up-error"><CircleAlert size={14} /> {error}</p> : null}
            <button type="button" className="primary-button primary-button--lg up-cta" disabled={!built || building || opening} onClick={() => void openInEditor()}>{opening ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Edit in Reality Builder</button>
            <button type="button" className="link-button up-another" onClick={remove}>Use a different image</button>
          </aside>
        </div>
      ) : (
        <div className="up-body">
          <section
            className={"up-drop" + (dragging ? " up-drop--over" : "")}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); const picked = event.dataTransfer.files[0]; if (picked && phase !== "analysing") void pick(picked); }}
          >
            <h1>Upload a room plan</h1>
            <p className="up-sub">Turn a top-down plan or sketch of one room into an editable 3D room you can furnish.</p>

            {file ? (
              <div className="up-preview">
                <img src={file.preview} alt="Uploaded plan" />
                {phase === "analysing" ? <div className="up-scan" /> : null}
              </div>
            ) : (
              <div className="up-art"><PlanSketch /></div>
            )}

            {phase === "analysing" ? (
              <ol className="up-steps" aria-live="polite">
                {STEPS.map((label, index) => (
                  <li key={label} className={index < step ? "done" : index === step ? "active" : ""}>
                    {index < step ? <Check size={14} /> : index === step ? <Loader2 size={14} className="spin" /> : <span className="up-dot" />} {label}…
                  </li>
                ))}
              </ol>
            ) : file ? (
              <>
                <p className="up-file"><FileImage size={15} /> {file.name}</p>
                <div className="up-actions">
                  <button type="button" className="ghost-button" onClick={() => input.current?.click()}><ImageUp size={15} /> Replace</button>
                  <button type="button" className="ghost-button" onClick={remove}><Trash2 size={15} /> Remove</button>
                  <button type="button" className="primary-button primary-button--lg" onClick={() => void analyse()}><Upload size={16} /> Generate 3D room</button>
                </div>
              </>
            ) : (
              <>
                <p className="up-hint">Drag it here or choose a file<br /><small>PNG, JPG, JPEG or WebP · photos of paper plans and hand sketches work too</small></p>
                <button type="button" className="primary-button primary-button--lg" onClick={() => input.current?.click()}><Upload size={17} /> Choose file</button>
              </>
            )}
            {error ? <p className="issue-inline issue-inline--error up-error"><CircleAlert size={14} /> {error}</p> : null}
            <input ref={input} type="file" accept={ACCEPT.join(",")} hidden onChange={(event) => { const picked = event.target.files?.[0]; if (picked) void pick(picked); }} />
          </section>

          <aside className="up-tips">
            <h2>How to get the best result</h2>
            <p>Upload one room, straight-on and uncropped, with walls, doors and windows visible. Sizes written on the plan are used as the real measurements.</p>
            <div className="up-example">
              <span className="up-badge up-badge--ok"><Check size={16} /></span>
              <div className="up-card"><PlanSketch /></div>
              <div className="up-card up-card--tilt"><PlanSketch /></div>
            </div>
            <div className="up-example">
              <span className="up-badge up-badge--bad"><X size={16} /></span>
              <div className="up-card up-card--blur"><PlanSketch /></div>
              <div className="up-card up-card--dark"><PlanSketch /></div>
            </div>
            <ul className="up-list">
              <li><FileImage size={15} /> One room per upload; for a full house plan you pick the room</li>
              <li><FileImage size={15} /> Dimensions in m, cm or feet (e.g. 12'-6")</li>
              <li><FileImage size={15} /> Avoid blur, shadows and steep angles</li>
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
