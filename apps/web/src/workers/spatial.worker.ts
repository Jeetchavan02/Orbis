/// <reference lib="webworker" />
import type { Scene } from "@reality-builder/shared";
import { generateRecoveryCandidates, validateScene, type RecoveryResult, type ValidationResult } from "@reality-builder/spatial-engine";

export type WorkerRequest =
  | { type: "validate"; id: number; scene: Scene; routes: boolean }
  | { type: "recover"; id: number; scene: Scene };

export type WorkerResponse =
  | { type: "validate"; id: number; result: ValidationResult }
  | { type: "recover"; id: number; result: RecoveryResult }
  | { type: "error"; id: number; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "validate") {
      scope.postMessage({ type: "validate", id: request.id, result: validateScene(request.scene, { routes: request.routes }) } satisfies WorkerResponse);
    } else {
      scope.postMessage({ type: "recover", id: request.id, result: generateRecoveryCandidates(request.scene) } satisfies WorkerResponse);
    }
  } catch (error) {
    scope.postMessage({ type: "error", id: request.id, message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  }
};
