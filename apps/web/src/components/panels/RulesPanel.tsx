import type { FurnitureCategory, RuleSettings } from "@reality-builder/shared";
import { CATEGORY_LABELS } from "../../data/catalog";
import { useWorkspaceStore } from "../../store/workspace";
import { NumberField, Section, Toggle } from "./fields";

export function RulesPanel() {
  const rules = useWorkspaceStore((state) => state.scene.rules);
  const settingsVersion = useWorkspaceStore((state) => state.scene.settingsVersion);
  const showRoutes = useWorkspaceStore((state) => state.showRoutes);
  const { dispatch, setShowRoutes } = useWorkspaceStore.getState();
  const update = (patch: Partial<RuleSettings>) => dispatch({ type: "scene.update", patch: { rules: patch } }, { base: { scene: settingsVersion } });

  return (
    <div className="inspector-scroll">
      <p className="panel-intro">Rules are saved with the scene, shared with collaborators, and undoable. Invalid layouts are allowed — rules explain problems, they never block edits.</p>
      <Section title="Checks">
        <Toggle label="Collisions" checked={rules.collisions} onChange={(collisions) => update({ collisions })} hint="RBush broad phase + SAT narrow phase" />
        <Toggle label="Room boundaries" checked={rules.boundaries} onChange={(boundaries) => update({ boundaries })} />
        <Toggle label="Front clearances" checked={rules.clearances} onChange={(clearances) => update({ clearances })} />
        <Toggle label="Pathways & doors" checked={rules.pathways} onChange={(pathways) => update({ pathways })} hint="Grid flood fill from doors, A* routes" />
      </Section>
      <Section title="Pathways">
        <NumberField label="Min. passage width" value={rules.minPassageWidth} min={0.4} max={1.5} onCommit={(minPassageWidth) => update({ minPassageWidth })} />
        <Toggle label="Show walking routes (A*)" checked={showRoutes} onChange={setShowRoutes} />
      </Section>
      <Section title="Default front clearance">
        <div className="field-grid">
          {(Object.keys(CATEGORY_LABELS) as FurnitureCategory[]).map((category) => (
            <NumberField
              key={category}
              label={CATEGORY_LABELS[category]}
              value={rules.categoryClearance[category] ?? 0}
              min={0}
              max={3}
              onCommit={(value) => update({ categoryClearance: { ...rules.categoryClearance, [category]: value } })}
            />
          ))}
        </div>
        <p className="field-note">Objects can override this in their Constraints section.</p>
      </Section>
    </div>
  );
}
