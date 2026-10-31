/// <reference lib="webworker" />
import { GuidelinePackSchema, type Scene } from "@reality-builder/shared";
import {
  evaluateGuidelines,
  generateRecoveryCandidates,
  optimizeLayout,
  scoreLayout,
  sunStudy,
  validateScene,
  type GuidelineReport,
  type LayoutScore,
  type OptimizationResult,
  type RecoveryResult,
  type SunStudy,
  type ValidationResult,
} from "@reality-builder/spatial-engine";
import vastuPackJson from "../../../fixtures/vastu-guidelines.json";

const vastuPack = GuidelinePackSchema.parse(vastuPackJson);

export type WorkerRequest =
  | { type: "validate"; id: number; scene: Scene; routes: boolean; roomId: string }
  | { type: "recover"; id: number; scene: Scene }
  | { type: "optimize"; id: number; scene: Scene; roomId: string }
  | { type: "sun"; id: number; scene: Scene; timestamp: number; mode: "instant" | "daily"; roomId: string };

export type WorkerResponse =
  | { type: "validate"; id: number; result: ValidationResult; score: LayoutScore; guidelines: GuidelineReport | null }
  | { type: "recover"; id: number; result: RecoveryResult }
  | { type: "optimize"; id: number; result: OptimizationResult }
  | { type: "sun"; id: number; result: SunStudy }
  | { type: "error"; id: number; request: WorkerRequest["type"]; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "validate": {
        const result = validateScene(request.scene, { routes: request.routes });
        scope.postMessage({
          type: "validate",
          id: request.id,
          result,
          score: scoreLayout(request.scene, result.issues, request.roomId),
          guidelines: request.scene.rules.vastu ? evaluateGuidelines(request.scene, vastuPack, request.roomId) : null,
        } satisfies WorkerResponse);
        return;
      }
      case "recover":
        scope.postMessage({ type: "recover", id: request.id, result: generateRecoveryCandidates(request.scene) } satisfies WorkerResponse);
        return;
      case "optimize":
        scope.postMessage({ type: "optimize", id: request.id, result: optimizeLayout(request.scene, { roomId: request.roomId }) } satisfies WorkerResponse);
        return;
      case "sun":
        scope.postMessage({ type: "sun", id: request.id, result: sunStudy(request.scene, new Date(request.timestamp), request.mode, request.roomId) } satisfies WorkerResponse);
        return;
    }
  } catch (error) {
    scope.postMessage({ type: "error", id: request.id, request: request.type, message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  }
};
