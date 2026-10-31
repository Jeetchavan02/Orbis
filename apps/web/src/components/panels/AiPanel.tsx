import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ImageUp, Loader2, Send, Sparkles, X } from "lucide-react";
import { AiEditResponseSchema, AiImageResponseSchema, type AiCatalogItem, type AiEditResponse, type AiImageResponse } from "@reality-builder/shared";
import { catalog } from "../../data/catalog";
import { useWorkspaceStore } from "../../store/workspace";

const aiCatalog: AiCatalogItem[] = catalog.filter((entry) => entry.id !== "box").map((entry) => ({ ...entry }));

const EXAMPLES = ["Add a bookshelf against a free wall", "Make it evening and dim the floor lamp", "Move the desk chair so the desk is usable and nothing is blocked"];

async function postJson<T>(url: string, body: unknown, schema: { parse: (value: unknown) => T }): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `Request failed (${response.status})`);
  return schema.parse(payload);
}

/** Downscales a photo in the browser so uploads stay small; returns base64 JPEG. */
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

export function AiPanel() {
  const [status, setStatus] = useState<{ available: boolean; model: string } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"edit" | "image" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiEditResponse | null>(null);
  const [image, setImage] = useState<{ preview: string; result: AiImageResponse | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const elapsed = useElapsed(busy !== null);
  const { dispatch, replaceScene, notify } = useWorkspaceStore.getState();

  useEffect(() => {
    fetch("/api/ai/status")
      .then((response) => response.json())
      .then(setStatus)
      .catch(() => setStatus({ available: false, model: "" }));
  }, []);

  const send = async () => {
    if (!instruction.trim() || busy) return;
    setBusy("edit");
    setError(null);
    setResult(null);
    try {
      // The current canonical scene is sent; the server validates every proposal with the spatial engine.
      setResult(await postJson("/api/ai/edit", { instruction, scene: useWorkspaceStore.getState().scene, roomId: useWorkspaceStore.getState().activeRoomId, catalog: aiCatalog }, AiEditResponseSchema));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const apply = () => {
    if (!result?.action) return;
    if (dispatch(result.action, { label: result.action.type === "batch" ? result.action.label : "AI edit" })) {
      notify("success", "AI changes applied. Undo with ⌘Z.");
      setResult(null);
      setInstruction("");
    }
  };

  const uploadPhoto = async (file: File) => {
    setBusy("image");
    setError(null);
    try {
      const encoded = await encodeImage(file);
      setImage({ preview: encoded.preview, result: null });
      const response = await postJson("/api/ai/image-to-room", { imageBase64: encoded.base64, mimeType: "image/jpeg", catalog: aiCatalog }, AiImageResponseSchema);
      setImage({ preview: encoded.preview, result: response });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (status && !status.available) {
    return (
      <div className="inspector-scroll">
        <div className="empty-state">
          <div className="empty-state-icon"><Sparkles size={18} /></div>
          <strong>AI is not configured</strong>
          <span>Add <code>GEMINI_API_KEY=…</code> to <code>apps/.env</code> and restart the server. The key is only used by the server.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-scroll">
      <p className="panel-intro">Describe a change. Gemini proposes tool calls; the spatial engine checks them and sends violations back for up to 3 corrections. Nothing changes until you apply. {status ? <span className="muted">Model: {status.model}</span> : null}</p>
      <textarea
        className="ai-input"
        placeholder="e.g. Add an armchair in a free corner for reading"
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
        }}
        rows={3}
        disabled={busy !== null}
      />
      <div className="ai-row">
        <div className="ai-examples">
          {EXAMPLES.map((example) => <button key={example} type="button" className="tiny-button" onClick={() => setInstruction(example)} disabled={busy !== null}>{example}</button>)}
        </div>
        <button type="button" className="primary-button" onClick={() => void send()} disabled={!instruction.trim() || busy !== null} title="Send (⌘↵)">
          {busy === "edit" ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {busy === "edit" ? `${elapsed}s` : "Propose"}
        </button>
      </div>

      {error ? <p className="issue-inline issue-inline--error">{error}</p> : null}

      {result ? (
        <section className={"ai-result ai-result--" + (result.status === "ok" && result.newIssues.length === 0 ? "ok" : "warn")}>
          <header>
            {result.status === "ok" ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
            <strong>{result.action ? (result.status === "ok" ? "Valid proposal" : "Proposal still has issues") : "No changes proposed"}</strong>
            <button type="button" className="icon-button" aria-label="Discard" onClick={() => setResult(null)}><X size={14} /></button>
          </header>
          <p>{result.summary}</p>
          <ol className="ai-attempts">
            {result.attempts.map((attempt) => (
              <li key={attempt.attempt}>
                <span className={"pill " + (attempt.outcome === "accepted" ? "pill--ok" : "pill--warn")}>Attempt {attempt.attempt}: {attempt.outcome.replace("-", " ")}</span>
                <span className="muted"> {attempt.calls.map((call) => call.tool).join(", ") || "no calls"}</span>
                {attempt.feedback ? <pre>{attempt.feedback}</pre> : null}
              </li>
            ))}
          </ol>
          {result.newIssues.length ? <ul className="ai-issues">{result.newIssues.map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul> : null}
          {result.action ? (
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setResult(null)}>Discard</button>
              <button type="button" className="primary-button" onClick={apply}>{result.newIssues.length ? `Apply anyway (${result.newIssues.length} issue${result.newIssues.length > 1 ? "s" : ""})` : "Apply"}</button>
            </div>
          ) : null}
          <p className="field-note">Answered by {result.model}.</p>
        </section>
      ) : null}

      <section className="inspector-block">
        <header className="inspector-block-title"><span>Photo to room</span><span className="section-hint">approximate</span></header>
        <p className="field-note">Upload a room photo. Gemini estimates the room size, openings and furniture, mapped to library items. You get an editable, validated scene — not an exact reconstruction.</p>
        <button type="button" className="import-card" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
          {busy === "image" ? <Loader2 size={16} className="spin" /> : <ImageUp size={16} />}
          <span><strong>{busy === "image" ? `Analyzing photo… ${elapsed}s` : "Upload a photo"}</strong><span>JPEG, PNG or WebP</span></span>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadPhoto(file);
        }} />
        {image ? (
          <div className="photo-result">
            <img src={image.preview} alt="Uploaded room" />
            {image.result ? (
              <>
                <p><strong>{image.result.scene.name}</strong> · {image.result.scene.rooms[0]!.dimensions.width.toFixed(1)} × {image.result.scene.rooms[0]!.dimensions.depth.toFixed(1)} m · {image.result.scene.furniture.length} objects · {image.result.scene.rooms[0]!.openings.length} openings</p>
                <p className="field-note">{image.result.notes || "No notes."} {image.result.issues.length ? `The spatial engine reports ${image.result.issues.length} issue(s) you can fix with Layout recovery.` : "Layout validates cleanly."}</p>
                <div className="modal-actions">
                  <button type="button" className="ghost-button" onClick={() => setImage(null)}>Discard</button>
                  <button type="button" className="primary-button" onClick={() => {
                    replaceScene(image.result!.scene, "Loaded the reconstructed room.");
                    setImage(null);
                  }}>Load as scene</button>
                </div>
              </>
            ) : busy === "image" ? null : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
