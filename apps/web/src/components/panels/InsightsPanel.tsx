import { CheckCircle2, Circle, Compass, Gauge, Loader2, Sparkles, Sun } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspace";
import { NumberField, Section, Toggle } from "./fields";

function toLocalInput(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function InsightsPanel() {
  const score = useWorkspaceStore((state) => state.score);
  const guidelines = useWorkspaceStore((state) => state.guidelines);
  const optimization = useWorkspaceStore((state) => state.optimization);
  const sun = useWorkspaceStore((state) => state.sun);
  const rules = useWorkspaceStore((state) => state.scene.rules);
  const environment = useWorkspaceStore((state) => state.scene.environment);
  const settingsVersion = useWorkspaceStore((state) => state.scene.settingsVersion);
  const { dispatch, runOptimization, applyOptimization, setOptimizationPreview, runSunStudy, setSunOverlay, selectEntity } = useWorkspaceStore.getState();
  const updateEnvironment = (patch: Partial<typeof environment>) => dispatch({ type: "scene.update", patch: { environment: patch } }, { base: { scene: settingsVersion } });

  const time = new Date(sun.timestamp);
  const minutes = time.getHours() * 60 + time.getMinutes();
  const setTime = (nextMinutes: number) => {
    const next = new Date(sun.timestamp);
    next.setHours(Math.floor(nextMinutes / 60), nextMinutes % 60, 0, 0);
    runSunStudy({ timestamp: next.getTime() });
  };

  return (
    <div className="inspector-scroll">
      <Section title="Layout score" aside={<span className="section-hint">0–100 · measured</span>}>
        {score ? (
          <>
            <div className="score-hero">
              <span className={"score-value score-value--" + (score.total >= 80 ? "good" : score.total >= 60 ? "ok" : "bad")}>{score.total}</span>
              <span className="field-note">Validity dominates: a layout with spatial errors can never score high.</span>
            </div>
            {score.components.map((component) => (
              <div key={component.id} className="score-row" title={component.detail}>
                <div className="score-row-head"><span>{component.label}</span><span>{component.score} / {component.max}</span></div>
                <div className="score-bar"><span style={{ width: `${(component.score / component.max) * 100}%` }} /></div>
                <span className="score-detail">{component.detail}</span>
              </div>
            ))}
          </>
        ) : <p className="field-note"><Loader2 size={12} className="spin" /> Scoring…</p>}

        {optimization.status === "idle" ? (
          <button type="button" className="primary-button primary-button--full" onClick={runOptimization}><Sparkles size={14} /> Optimize layout</button>
        ) : null}
        {optimization.status === "running" ? <p className="field-note"><Loader2 size={12} className="spin" /> Hill-climbing; every candidate is revalidated…</p> : null}
        {optimization.status === "error" ? <p className="issue-inline issue-inline--error">{optimization.message}</p> : null}
        {optimization.status === "done" && optimization.result ? (
          <div className="candidate candidate--active">
            <div className="candidate-head">
              <strong>Score {optimization.result.before.total} → {optimization.result.after.total}</strong>
              <span className="pill pill--ok">{optimization.result.accepted} improvements</span>
            </div>
            {optimization.result.moves.length ? (
              <ul>{optimization.result.moves.map((move) => <li key={move.objectId}>{move.name}: {Math.hypot(move.to[0] - move.from[0], move.to[1] - move.from[1]).toFixed(2)} m{move.yawTo !== move.yawFrom ? `, rotated to ${move.yawTo}°` : ""}</li>)}</ul>
            ) : <p className="field-note">No better layout found that keeps every hard constraint.</p>}
            <p className="field-note">{optimization.result.evaluated} candidates revalidated in {optimization.result.durationMs.toFixed(0)} ms. Steps that added any spatial issue were rejected.</p>
            <Toggle label="Preview in viewport" checked={optimization.preview} onChange={setOptimizationPreview} />
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => useWorkspaceStore.setState({ optimization: { status: "idle", result: null, preview: false } })}>Discard</button>
              <button type="button" className="primary-button" onClick={applyOptimization} disabled={!optimization.result.action}>Apply</button>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Sunlight" aside={<span className="section-hint">approximate</span>}>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Date</span>
            <span className="field-input"><input type="date" value={toLocalInput(sun.timestamp)} onChange={(event) => {
              const [year, month, day] = event.target.value.split("-").map(Number);
              if (!year || !month || !day) return;
              const next = new Date(sun.timestamp);
              next.setFullYear(year, month - 1, day);
              runSunStudy({ timestamp: next.getTime() });
            }} /></span>
          </label>
          <div className="field">
            <span className="field-label">Mode</span>
            <div className="segmented segmented--full">
              <button type="button" className={sun.mode === "instant" ? "active" : ""} onClick={() => runSunStudy({ mode: "instant" })}>At time</button>
              <button type="button" className={sun.mode === "daily" ? "active" : ""} onClick={() => runSunStudy({ mode: "daily" })}>Whole day</button>
            </div>
          </div>
        </div>
        {sun.mode === "instant" ? (
          <label className="field">
            <span className="field-label">Time · {String(Math.floor(minutes / 60)).padStart(2, "0")}:{String(minutes % 60).padStart(2, "0")} (your local time)</span>
            <input type="range" min={300} max={1200} step={15} value={minutes} onChange={(event) => setTime(Number(event.target.value))} />
          </label>
        ) : null}
        {sun.status === "idle" ? <button type="button" className="primary-button primary-button--full" onClick={() => runSunStudy()}><Sun size={14} /> Run sun study</button> : null}
        {sun.status === "error" ? <p className="issue-inline issue-inline--error">{sun.message}</p> : null}
        {sun.result ? (
          <div className="sun-result">
            <p>
              {sun.result.sun.daylight ? <>Sun at <strong>{Math.round(sun.result.sun.bearingDeg)}°</strong> bearing, <strong>{Math.round(sun.result.sun.altitudeDeg)}°</strong> altitude. </> : <>The sun is below the horizon at this time. </>}
              {sun.result.mode === "instant"
                ? <><strong>{Math.round(sun.result.summary * 100)}%</strong> of the floor gets direct sun.</>
                : <>Floor average <strong>{sun.result.summary.toFixed(1)} h</strong> of direct sun; brightest spot {Math.max(0, ...sun.result.values).toFixed(1)} h.</>}
              {sun.status === "running" ? <Loader2 size={12} className="spin" /> : null}
            </p>
            {sun.result.objects.length ? (
              <ul className="sun-objects">
                {sun.result.objects.map((object) => (
                  <li key={object.id}><button type="button" onClick={() => selectEntity(object.id)}>{object.name}</button><span>{sun.result!.mode === "instant" ? `${Math.round(object.value * 100)}% of surface lit` : `${object.value.toFixed(1)} h of sun`}</span></li>
                ))}
              </ul>
            ) : null}
            <Toggle label="Show on floor" checked={sun.overlay} onChange={setSunOverlay} />
            <details className="assumptions"><summary>Assumptions</summary><ul>{sun.result.assumptions.map((line) => <li key={line}>{line}</li>)}</ul><p>{sun.result.samples.toLocaleString()} rays in {sun.result.durationMs.toFixed(0)} ms (SunCalc + ray casting through windows).</p></details>
          </div>
        ) : null}
        <div className="field-grid">
          <NumberField label="Latitude" suffix="°" step={0.01} min={-90} max={90} value={environment.latitude} onCommit={(latitude) => updateEnvironment({ latitude })} />
          <NumberField label="Longitude" suffix="°" step={0.01} min={-180} max={180} value={environment.longitude} onCommit={(longitude) => updateEnvironment({ longitude })} />
        </div>
        <NumberField label="Room north offset (bearing of the north wall)" suffix="°" step={15} min={0} max={359} value={environment.northOffsetDegrees} onCommit={(northOffsetDegrees) => updateEnvironment({ northOffsetDegrees })} />
      </Section>

      <Section title="Vastu guidelines" aside={<span className="section-hint">optional · advisory</span>}>
        <Toggle label="Evaluate Vastu guidelines" checked={rules.vastu} onChange={(vastu) => dispatch({ type: "scene.update", patch: { rules: { vastu } } }, { base: { scene: settingsVersion } })} />
        {rules.vastu && guidelines ? (
          <>
            <div className="score-hero"><span className={"score-value score-value--" + (guidelines.score >= 75 ? "good" : guidelines.score >= 50 ? "ok" : "bad")}><Compass size={16} /> {guidelines.score}%</span><span className="field-note">{guidelines.packName}</span></div>
            <ul className="guideline-list">
              {guidelines.results.map((result) => (
                <li key={result.ruleId + result.objectId}>
                  <button type="button" onClick={() => selectEntity(result.objectId)} title={result.explanation}>
                    {result.satisfied ? <CheckCircle2 size={14} className="guideline-ok" /> : <Circle size={14} className="guideline-miss" />}
                    <span><strong>{result.title}</strong><span>{result.objectName}: {result.observed} (suggested {result.expected})</span></span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="field-note">{guidelines.disclaimer}</p>
          </>
        ) : <p className="field-note">Compass-based placement suggestions from a configurable JSON rule pack (<code>fixtures/vastu-guidelines.json</code>). Uses the room north offset above. They never override collision, clearance or pathway rules.</p>}
      </Section>
      <p className="field-note"><Gauge size={11} /> All insights run in the spatial-engine worker.</p>
    </div>
  );
}
