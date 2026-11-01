import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, FileText, Loader2, RotateCcw, Share2, X } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspace";
import { useExportPdf } from "../../lib/ui";
import { buildDesignPdf, pdfFilename, renderDesignViews, type ExportProgress } from "../../lib/designPdf";
import { canShareFiles, downloadBlob, openWhatsApp, shareMessage } from "../../lib/share";
import { currentProjectId, projectUrl } from "../../lib/project";
import { WhatsAppIcon } from "./WhatsAppIcon";

type State =
  | { status: "working"; progress: ExportProgress }
  | { status: "done"; file: File; url: string; views: number }
  | { status: "error"; message: string };

const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Generates the multi-view design PDF from the live scene, then offers preview, download and sharing. */
export function ExportPdfDialog() {
  const open = useExportPdf((state) => state.open);
  const setOpen = useExportPdf((state) => state.setOpen);
  const [state, setState] = useState<State>({ status: "working", progress: { step: "render", done: 0, total: 1, label: "Preparing" } });
  const [downloaded, setDownloaded] = useState(false);
  const run = useRef(0);

  const link = projectUrl(currentProjectId() ?? "default");

  const generate = async () => {
    const id = ++run.current;
    setDownloaded(false);
    setState({ status: "working", progress: { step: "render", done: 0, total: 1, label: "Preparing the scene" } });
    const { setCapturing } = useExportPdf.getState();
    // Snapshot: the report shows the scene as it was when export started, even if collaborators keep editing.
    const { scene, activeRoomId } = useWorkspaceStore.getState();
    const room = scene.rooms.find((entry) => entry.id === activeRoomId) ?? scene.rooms[0];
    try {
      if (!room) throw new Error("This project has no room to export yet.");
      setCapturing(true);
      await nextFrames(); // let the viewport drop grid, gizmos and highlights before rendering
      const views = await renderDesignViews(room, (progress) => run.current === id && setState({ status: "working", progress }));
      setCapturing(false);
      const blob = await buildDesignPdf(scene, room, views, link, (progress) => run.current === id && setState({ status: "working", progress }));
      if (run.current !== id) return;
      const file = new File([blob], pdfFilename(scene), { type: "application/pdf" });
      setState({ status: "done", file, url: URL.createObjectURL(file), views: views.length });
    } catch (error) {
      console.error("Design PDF export failed", error);
      if (run.current === id) setState({ status: "error", message: error instanceof Error ? error.message : "The PDF couldn't be generated." });
    } finally {
      setCapturing(false);
    }
  };

  useEffect(() => {
    if (open) void generate();
    else run.current += 1; // abandon an export in progress
  }, [open]);

  useEffect(() => {
    if (state.status !== "done") return;
    return () => URL.revokeObjectURL(state.url);
  }, [state]);

  if (!open) return null;
  const close = () => setOpen(false);

  const download = () => {
    if (state.status !== "done") return;
    downloadBlob(state.file, state.file.name);
    setDownloaded(true);
  };
  const share = async () => {
    if (state.status !== "done") return;
    try {
      await navigator.share({ files: [state.file], title: state.file.name, text: shareMessage(link) });
    } catch (error) {
      if ((error as Error).name !== "AbortError") useWorkspaceStore.getState().notify("error", "Sharing failed. Download the PDF and attach it manually.");
    }
  };
  const fileShare = state.status === "done" && canShareFiles(state.file);
  const percent = state.status === "working" ? Math.round(((state.progress.step === "render" ? state.progress.done / state.progress.total * 0.85 : 0.85 + 0.15 * state.progress.done)) * 100) : 100;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(event) => event.target === event.currentTarget && state.status !== "working" && close()}>
      <div className="modal export-modal">
        <header className="share-head">
          <h2 id="export-title"><FileText size={17} /> Design PDF</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={close}><X size={16} /></button>
        </header>

        {state.status === "working" ? (
          <div className="export-progress" aria-live="polite">
            <Loader2 size={22} className="spin" />
            <strong>{state.progress.step === "render" ? `Rendering views · ${Math.min(state.progress.done + 1, state.progress.total)} of ${state.progress.total}` : "Assembling the PDF"}</strong>
            <span className="muted">{state.progress.label}</span>
            <div className="export-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: percent + "%" }} /></div>
            <span className="field-note">Each view is rendered from the live 3D scene. Your project isn't changed.</span>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="export-progress">
            <span className="modal-icon modal-icon--warn"><AlertTriangle size={18} /></span>
            <strong>Export failed</strong>
            <span className="muted">{state.message}</span>
            <button type="button" className="primary-button" onClick={() => void generate()}><RotateCcw size={14} /> Try again</button>
          </div>
        ) : null}

        {state.status === "done" ? (
          <>
            <div className="export-ready"><Check size={15} /> <span><strong>{state.file.name}</strong> · {state.views} views · {(state.file.size / 1024 / 1024).toFixed(1)} MB</span></div>
            <iframe className="export-preview" src={state.url + "#view=FitH"} title="PDF preview" />
            <div className="export-actions">
              <button type="button" className="primary-button" onClick={download}>{downloaded ? <><Check size={14} /> Downloaded</> : <><Download size={14} /> Download PDF</>}</button>
              {fileShare ? <button type="button" className="ghost-button" onClick={() => void share()}><Share2 size={14} /> Share PDF…</button> : null}
              <button type="button" className="whatsapp-button" onClick={() => openWhatsApp(shareMessage(link))}><WhatsAppIcon size={15} /> Share on WhatsApp</button>
              <button type="button" className="ghost-button" onClick={() => void generate()} title="Render the views again from the current scene"><RotateCcw size={14} /> Regenerate</button>
            </div>
            <p className="field-note export-note">
              {fileShare
                ? "Share PDF opens your device's share sheet, where you can pick WhatsApp, Mail or any other app with the file attached. Share on WhatsApp sends the live project link as a message."
                : "This browser can't attach files to other apps directly. Download the PDF, then attach it in WhatsApp or your email app. Share on WhatsApp sends the live project link as a message."}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
