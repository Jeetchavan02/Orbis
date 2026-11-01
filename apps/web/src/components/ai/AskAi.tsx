import { useEffect, useRef, useState } from "react";
import { openProject } from "../../lib/project";
import { ArrowUp, Check, CircleAlert, ImagePlus, Loader2, Sparkles, Trash2, Wand2, X } from "lucide-react";
import {
  AiEditResponseSchema,
  AiImageResponseSchema,
  type AiCatalogItem,
  type AiEditResponse,
  type AiImageResponse,
  type SceneAction,
} from "@reality-builder/shared";
import { catalog } from "../../data/catalog";
import { useAskAi } from "../../lib/ui";
import { useWorkspaceStore } from "../../store/workspace";

const aiCatalog: AiCatalogItem[] = catalog.filter((entry) => entry.id !== "box").map((entry) => ({ ...entry }));

type Mode = "edit" | "create" | "photo";
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "edit", label: "Edit this room", hint: "Ask for a change to the room you're in" },
  { id: "create", label: "Create a room", hint: "Describe a room and AI designs it as a new project" },
  { id: "photo", label: "From photo or sketch", hint: "Upload a room photo or a sketch with measurements" },
];
const SUGGESTIONS: Record<Mode, string[]> = {
  edit: ["Add a bookshelf against a free wall", "Make it cosy for the evening", "Add plants to the empty corners", "Fix the layout problems"],
  create: ["A cosy 4 × 3.5 m home office with a reading corner", "A bright 5 × 4 m living room for a family of four", "A compact 3 × 3 m kids' bedroom with a desk"],
  photo: [],
};

type Turn =
  | { id: number; role: "user"; text: string; image?: string }
  | { id: number; role: "assistant"; kind: "edit"; result: AiEditResponse; applied?: boolean; discarded?: boolean }
  | { id: number; role: "assistant"; kind: "room"; result: AiImageResponse; opened?: boolean }
  | { id: number; role: "assistant"; kind: "error"; text: string };

async function postJson<T>(url: string, body: unknown, schema: { parse: (value: unknown) => T }): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `Request failed (${response.status})`);
  return schema.parse(payload);
}

async function encodeImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.split(",")[1]!, preview: dataUrl };
}

/** Plain-language list of what an AI proposal changes, with deletions flagged. */
function describeChanges(action: SceneAction | null) {
  if (!action) return { lines: [] as string[], removed: [] as string[] };
  const { scene } = useWorkspaceStore.getState();
  const nameOf = (id: string) => scene.furniture.find((item) => item.id === id)?.name ?? "an object";
  const steps = action.type === "batch" ? action.actions : [action];
  const lines: string[] = [];
  const removed: string[] = [];
  for (const step of steps) {
    if (step.type === "furniture.create") lines.push(`Add ${step.furniture.name.split(" — ")[0]}`);
    else if (step.type === "furniture.delete") removed.push(nameOf(step.furnitureId));
    else if (step.type === "furniture.update") {
      const verbs = [
        step.patch.position ? "move" : null,
        step.patch.yawDegrees !== undefined ? "rotate" : null,
        step.patch.dimensions ? "resize" : null,
        step.patch.color ? "recolour" : null,
        step.patch.light ? "adjust light of" : null,
      ].filter(Boolean);
      const verb = verbs.join(" & ") || "update";
      lines.push(`${verb[0]!.toUpperCase()}${verb.slice(1)} ${nameOf(step.furnitureId)}`);
    } else if (step.type === "scene.update" && step.patch.environment?.mode) lines.push(`Switch lighting to ${step.patch.environment.mode}`);
    else lines.push("Update the room");
  }
  return { lines, removed };
}

function useElapsed(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return seconds;
}

let nextTurnId = 1;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type HistoryTurn = { role: "user" | "assistant"; text: string };

/** Gemini-style assistant panel: one place for every AI feature, in plain language. */
export function AskAiPanel() {
  const open = useAskAi((state) => state.open);
  const setOpen = useAskAi((state) => state.setOpen);
  const [mode, setMode] = useState<Mode>("edit");
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const elapsed = useElapsed(busy);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ai/status").then((response) => response.json()).then((data: { available: boolean }) => setAvailable(data.available)).catch(() => setAvailable(false));
  }, []);
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, mode]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        useAskAi.getState().setOpen(!useAskAi.getState().open);
      } else if (event.key === "Escape" && useAskAi.getState().open) useAskAi.getState().setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;

  const push = (turn: DistributiveOmit<Turn, "id">) => setTurns((current) => [...current, { ...turn, id: nextTurnId++ } as Turn]);
  const update = (id: number, patch: Partial<Turn>) => setTurns((current) => current.map((turn) => (turn.id === id ? ({ ...turn, ...patch } as Turn) : turn)));

  const history = () => turns.flatMap((turn): HistoryTurn[] => {
    if (turn.role === "user") return [{ role: "user", text: turn.text }];
    if (turn.kind === "edit") return [{ role: "assistant", text: turn.result.summary + (turn.applied ? " (applied)" : turn.discarded ? " (discarded)" : "") }];
    return [];
  }).slice(-8);

  const send = async (raw?: string) => {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    setText("");
    push({ role: "user", text: message });
    setBusy(true);
    try {
      const state = useWorkspaceStore.getState();
      if (mode === "create") {
        const result = await postJson("/api/ai/brief-to-room", { brief: message, catalog: aiCatalog }, AiImageResponseSchema);
        push({ role: "assistant", kind: "room", result });
      } else {
        const result = await postJson("/api/ai/edit", { instruction: message, scene: state.scene, roomId: state.activeRoomId, catalog: aiCatalog, history: history() }, AiEditResponseSchema);
        push({ role: "assistant", kind: "edit", result });
      }
    } catch (error) {
      push({ role: "assistant", kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      const encoded = await encodeImage(file);
      push({ role: "user", text: file.name, image: encoded.preview });
      const result = await postJson("/api/ai/image-to-room", { imageBase64: encoded.base64, mimeType: "image/jpeg", catalog: aiCatalog }, AiImageResponseSchema);
      push({ role: "assistant", kind: "room", result });
    } catch (error) {
      push({ role: "assistant", kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openAsProject = async (turn: Extract<Turn, { kind: "room" }>) => {
    const { notify } = useWorkspaceStore.getState();
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: turn.result.scene.name, roomType: turn.result.scene.roomType, scene: turn.result.scene }) });
      const body = await response.json() as { id?: string; ownerKey?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Could not create the project.");
      update(turn.id, { opened: true });
      openProject(body.id, body.ownerKey);
    } catch (error) {
      notify("error", (error as Error).message);
    }
  };

  const busyLabel = mode === "edit" ? "Designing the change and checking the layout" : mode === "create" ? "Designing your room" : "Reading your image";

  return (
    <aside className="askai" role="dialog" aria-label="Ask AI">
      <header className="askai-head">
        <span className="askai-spark"><Sparkles size={16} /></span>
        <strong>Ask AI</strong>
        <kbd className="askai-kbd">⌘K</kbd>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
      </header>

      <div className="askai-modes" role="tablist">
        {MODES.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={mode === entry.id} className={mode === entry.id ? "active" : ""} onClick={() => setMode(entry.id)} title={entry.hint}>{entry.label}</button>
        ))}
      </div>

      <div className="askai-body" ref={scrollRef}>
        {available === false ? (
          <div className="askai-empty">
            <CircleAlert size={18} />
            <p>AI isn't set up on the server. Add <code>GEMINI_API_KEY</code> to <code>apps/.env</code> and restart.</p>
          </div>
        ) : turns.length === 0 ? (
          <div className="askai-empty">
            <span className="askai-hero"><Sparkles size={22} /></span>
            <h3>{mode === "edit" ? "What should change in this room?" : mode === "create" ? "Describe the room you want" : "Turn a photo or sketch into a room"}</h3>
            <p>{MODES.find((entry) => entry.id === mode)!.hint}. You review every change before it's applied, and the layout engine checks it first.</p>
            {mode === "photo" ? (
              <button type="button" className="askai-upload" onClick={() => fileRef.current?.click()} disabled={busy}>
                <ImagePlus size={18} /> Upload a photo or sketch
                <small>Write measurements on sketches, e.g. “4 m”, and they're used exactly</small>
              </button>
            ) : (
              <div className="askai-suggestions">
                {SUGGESTIONS[mode].map((suggestion) => <button key={suggestion} type="button" onClick={() => void send(suggestion)} disabled={busy}>{suggestion}</button>)}
              </div>
            )}
          </div>
        ) : (
          turns.map((turn) => <TurnView key={turn.id} turn={turn} onUpdate={(patch) => update(turn.id, patch)} onOpen={openAsProject} />)
        )}
        {busy ? (
          <div className="askai-thinking">
            <span className="askai-spark askai-spark--spin"><Sparkles size={14} /></span>
            <span className="askai-shimmer">{busyLabel}…</span>
            <small>{elapsed}s</small>
          </div>
        ) : null}
      </div>

      {mode === "photo" ? (
        <div className="askai-compose askai-compose--photo">
          <button type="button" className="primary-button" onClick={() => fileRef.current?.click()} disabled={busy || available === false}><ImagePlus size={15} /> Upload image</button>
        </div>
      ) : (
        <form className="askai-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder={mode === "edit" ? "Ask for a change… e.g. move the sofa to face the window" : "Describe the room… size, style, who uses it"}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            disabled={available === false}
          />
          <button type="submit" className="askai-send" disabled={!text.trim() || busy || available === false} aria-label="Send">
            {busy ? <Loader2 size={16} className="spin" /> : <ArrowUp size={16} />}
          </button>
        </form>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); }} />
    </aside>
  );
}

function TurnView({ turn, onUpdate, onOpen }: { turn: Turn; onUpdate: (patch: Partial<Turn>) => void; onOpen: (turn: Extract<Turn, { kind: "room" }>) => void }) {
  const [allowRemoval, setAllowRemoval] = useState(false);
  if (turn.role === "user") {
    return (
      <div className="askai-user">
        {turn.image ? <img src={turn.image} alt="" /> : null}
        <p>{turn.text}</p>
      </div>
    );
  }
  if (turn.kind === "error") {
    return <div className="askai-card askai-card--error"><CircleAlert size={15} /><p>{turn.text}</p></div>;
  }
  if (turn.kind === "room") {
    const room = turn.result.scene.rooms[0]!;
    return (
      <div className="askai-card">
        <p className="askai-summary"><strong>{turn.result.scene.name}</strong> · {room.dimensions.width.toFixed(1)} × {room.dimensions.depth.toFixed(1)} m · {turn.result.scene.furniture.length} items</p>
        <ul className="askai-changes">{turn.result.scene.furniture.slice(0, 8).map((item) => <li key={item.id}>{item.name.split(" — ")[0]}</li>)}{turn.result.scene.furniture.length > 8 ? <li>+{turn.result.scene.furniture.length - 8} more</li> : null}</ul>
        {turn.result.notes ? <p className="askai-note">{turn.result.notes}</p> : null}
        <p className={"askai-check " + (turn.result.issues.length ? "warn" : "ok")}>{turn.result.issues.length ? `${turn.result.issues.length} layout issue${turn.result.issues.length === 1 ? "" : "s"} left to review` : "Layout checked: no problems"}</p>
        <div className="askai-actions">
          <button type="button" className="primary-button" onClick={() => onOpen(turn)} disabled={turn.opened}><Wand2 size={14} /> {turn.opened ? "Opening…" : "Open as new project"}</button>
        </div>
      </div>
    );
  }
  const { result } = turn;
  const { lines, removed } = describeChanges(result.action);
  const tries = result.attempts.length;
  const done = turn.applied || turn.discarded;
  const apply = () => {
    if (!result.action) return;
    const { dispatch, notify } = useWorkspaceStore.getState();
    if (dispatch(result.action, { label: result.action.type === "batch" ? result.action.label : "AI edit" })) {
      notify("success", "AI change applied. Undo with ⌘Z.");
      onUpdate({ applied: true });
    }
  };
  return (
    <div className={"askai-card" + (done ? " askai-card--done" : "")}>
      <p className="askai-summary">{result.summary}</p>
      {lines.length || removed.length ? (
        <ul className="askai-changes">
          {lines.map((line, index) => <li key={index}>{line}</li>)}
          {removed.map((name, index) => <li key={"r" + index} className="removed"><Trash2 size={12} /> Remove {name}</li>)}
        </ul>
      ) : null}
      {result.action ? (
        <p className={"askai-check " + (result.newIssues.length ? "warn" : "ok")}>
          {result.newIssues.length
            ? `Still causes ${result.newIssues.length} layout issue${result.newIssues.length === 1 ? "" : "s"}: ${result.newIssues[0]!.message}`
            : `Layout checked${tries > 1 ? ` — fixed on try ${tries}` : ""}: no new problems`}
        </p>
      ) : null}
      {result.action && !done ? (
        <>
          {removed.length ? (
            <label className="askai-confirm"><input type="checkbox" checked={allowRemoval} onChange={(event) => setAllowRemoval(event.target.checked)} /> OK to remove {removed.length === 1 ? removed[0] : `these ${removed.length} items`}</label>
          ) : null}
          <div className="askai-actions">
            <button type="button" className="ghost-button" onClick={() => onUpdate({ discarded: true })}>Discard</button>
            <button type="button" className="primary-button" onClick={apply} disabled={removed.length > 0 && !allowRemoval}><Check size={14} /> {result.newIssues.length ? "Apply anyway" : "Apply"}</button>
          </div>
        </>
      ) : null}
      {turn.applied ? <p className="askai-status ok"><Check size={12} /> Applied · ⌘Z to undo</p> : turn.discarded ? <p className="askai-status">Discarded</p> : null}
    </div>
  );
}
