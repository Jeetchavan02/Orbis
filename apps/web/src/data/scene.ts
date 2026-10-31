import { SceneSchema } from "@reality-builder/shared";
import fixture from "../../../fixtures/bedroom-scene.json";

/** Demo scene used before the server answers, and when working offline. */
export const starterScene = SceneSchema.parse(fixture);

import apartmentFixture from "../../../fixtures/apartment-scene.json";

/** Larger demo: three storeys (living/kitchen, master bedroom, studio loft). */
export const apartmentScene = SceneSchema.parse(apartmentFixture);
