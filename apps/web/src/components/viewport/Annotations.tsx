import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import type { Annotation, Room } from "@reality-builder/shared";
import { X } from "lucide-react";
import { activeRoom } from "../../lib/placement";
import { addAnnotation, removeAnnotation, useAnnotate } from "../../lib/tools";
import { useWorkspaceStore } from "../../store/workspace";
import { drag } from "./Interaction";

const LIFT = 0.02;
const metres = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(b.x - a.x, b.z - a.z);
const snap = (value: number, shift: boolean) => (shift ? value : Math.round(value * 20) / 20); // 5 cm unless Shift

/** L / T tools: clicks on the floor (captured before selection and dragging) create lines and labels. */
export function AnnotationController() {
  const { gl } = useThree();
  useEffect(() => {
    const floorHit = (event: PointerEvent) => {
      const room = activeRoom(useWorkspaceStore.getState().scene);
      const hit = room && drag.floorPoint?.(event.clientX, event.clientY, room.position.y);
      return hit ? { x: snap(hit.x, event.shiftKey), z: snap(hit.z, event.shiftKey), roomId: room!.id } : null;
    };
    const onMove = (event: PointerEvent) => {
      const { mode, start, set } = useAnnotate.getState();
      if (mode !== "line" || !start || event.target !== gl.domElement) return;
      const hit = floorHit(event);
      if (hit) set({ hover: hit });
    };
    const onDown = (event: PointerEvent) => {
      const { mode, start, set } = useAnnotate.getState();
      if (!mode || event.target !== gl.domElement || event.button !== 0) return;
      event.stopPropagation();
      const hit = floorHit(event);
      if (!hit) return;
      if (mode === "text") {
        // Keep the browser from moving focus to the canvas, which would instantly blur (and close) the label box.
        event.preventDefault();
        return set({ pending: { x: hit.x, z: hit.z, clientX: event.clientX, clientY: event.clientY } });
      }
      if (!start) return set({ start: hit, hover: hit });
      if (metres(start, hit) >= 0.05) addAnnotation({ kind: "line", roomId: hit.roomId, x: start.x, z: start.z, x2: hit.x, z2: hit.z });
      set({ start: null, hover: null });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && useAnnotate.getState().mode) useAnnotate.getState().set({ mode: null, start: null, hover: null, pending: null });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [gl]);
  return null;
}

function floorY(rooms: Room[], roomId?: string) {
  return ((rooms.find((room) => room.id === roomId) ?? rooms[0])?.position.y ?? 0) + LIFT;
}

function Tag({ children, onRemove, tone = "line" }: { children: React.ReactNode; onRemove?: () => void; tone?: "line" | "text" | "draft" }) {
  return (
    <span className={"anno-tag anno-tag--" + tone}>
      {children}
      {onRemove ? <button type="button" aria-label="Remove" title="Remove" onClick={(event) => { event.stopPropagation(); onRemove(); }}><X size={11} /></button> : null}
    </span>
  );
}

/** Measuring lines with their length, and text labels, drawn on the floor; plus the line being drawn. */
export function Annotations({ annotations, rooms, visibleRooms }: { annotations: Annotation[]; rooms: Room[]; visibleRooms: Set<string> }) {
  const start = useAnnotate((state) => state.start);
  const hover = useAnnotate((state) => state.hover);
  const draftRoom = activeRoom(useWorkspaceStore((state) => state.scene));
  return (
    <group>
      {annotations.filter((entry) => !entry.roomId || visibleRooms.has(entry.roomId)).map((entry) => {
        const y = floorY(rooms, entry.roomId);
        if (entry.kind === "line" && entry.x2 !== undefined && entry.z2 !== undefined) {
          const end = { x: entry.x2, z: entry.z2 };
          return (
            <group key={entry.id}>
              <Line points={[[entry.x, y, entry.z], [end.x, y, end.z]]} color={entry.color} lineWidth={2.5} />
              {[[entry.x, entry.z], [end.x, end.z]].map(([x, z], index) => (
                <mesh key={index} position={[x!, y, z!]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}><circleGeometry args={[0.03, 16]} /><meshBasicMaterial color={entry.color} /></mesh>
              ))}
              <Html position={[(entry.x + end.x) / 2, y, (entry.z + end.z) / 2]} center zIndexRange={[20, 10]}>
                <Tag onRemove={() => removeAnnotation(entry.id)}>{metres(entry, end).toFixed(2)} m</Tag>
              </Html>
            </group>
          );
        }
        return (
          <Html key={entry.id} position={[entry.x, y, entry.z]} center zIndexRange={[20, 10]}>
            <Tag tone="text" onRemove={() => removeAnnotation(entry.id)}>{entry.text}</Tag>
          </Html>
        );
      })}
      {start && hover && draftRoom ? (
        <group>
          <Line points={[[start.x, floorY(rooms, draftRoom.id), start.z], [hover.x, floorY(rooms, draftRoom.id), hover.z]]} color="#6a3de8" lineWidth={2} dashed dashSize={0.08} gapSize={0.05} />
          <Html position={[(start.x + hover.x) / 2, floorY(rooms, draftRoom.id), (start.z + hover.z) / 2]} center><Tag tone="draft">{metres(start, hover).toFixed(2)} m</Tag></Html>
        </group>
      ) : null}
    </group>
  );
}

/** The text box that appears where you clicked with the Text tool (outside the canvas). */
export function LabelInput() {
  const pending = useAnnotate((state) => state.pending);
  const set = useAnnotate((state) => state.set);
  if (!pending) return null;
  const openedAt = performance.now();
  const finish = (text: string) => {
    const room = activeRoom(useWorkspaceStore.getState().scene);
    if (text.trim()) addAnnotation({ kind: "text", roomId: room?.id, x: pending.x, z: pending.z, text: text.trim().slice(0, 120) });
    set({ pending: null });
  };
  return (
    <input
      className="anno-input"
      style={{ left: pending.clientX, top: pending.clientY }}
      autoFocus
      maxLength={120}
      placeholder="Type a label, press Enter"
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") set({ pending: null });
        event.stopPropagation();
      }}
      onBlur={(event) => {
        // A blur in the same instant it opened is the click that placed it, not the user leaving the box.
        if (performance.now() - openedAt < 300) return event.currentTarget.focus();
        finish(event.currentTarget.value);
      }}
    />
  );
}
