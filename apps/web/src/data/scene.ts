import { SceneSchema } from "@reality-builder/shared";
import fixture from "../../../fixtures/bedroom-scene.json";

/** Demo scene used before the server answers, and when working offline. */
export const starterScene = SceneSchema.parse(fixture);
