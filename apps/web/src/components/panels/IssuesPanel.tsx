import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Loader2, Sparkles, Wand2 } from "lucide-react";
import type { ValidationIssue } from "@reality-builder/shared";
import { useWorkspaceStore } from "../../store/workspace";

const RULE_LABELS: Record<ValidationIssue["ruleId"], string> = {
  "collision.overlap": "Collision",
  "boundary.outside-room": "Room boundary",
  "clearance.front": "Clearance",
  "pathway.blocked": "Blocked pathway",
  "pathway.door-blocked": "Door swing",
};

export function IssuesPanel() {
  const validation = useWorkspaceStore((state) => state.validation);
  const recovery = useWorkspaceStore((state) => state.recovery);
  const selectedId = useWorkspaceStore((state) => state.selectedEntityId);
  const { selectEntity, runRecovery, previewCandidate, applyCandidate, requestFocus } = useWorkspaceStore.getState();

  if (!validation) {
    return <div className="empty-state"><Loader2 className="spin" size={18} /><span>Running spatial checks…</span></div>;
  }
  const issues = validation.issues;
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;

  return (
    <div className="inspector-scroll">
      <div className={"issues-summary issues-summary--" + (errors ? "error" : warnings ? "warning" : "ok")}>
        {issues.length === 0 ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
        <div>
          <strong>{issues.length === 0 ? "Layout is valid" : `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`}</strong>
          <span>Checked {validation.stats.objectCount} objects in {validation.stats.durationMs.toFixed(1)} ms</span>
        </div>
      </div>

      {issues.length > 0 ? (
        <section className="recovery-card">
          <header>
            <Wand2 size={15} />
            <div>
              <strong>Layout recovery</strong>
              <span>Searches nearby positions and rotations, revalidates every candidate, and only shows ones that improve the layout.</span>
            </div>
          </header>
          {recovery.status === "idle" ? (
            <button type="button" className="primary-button primary-button--full" onClick={runRecovery}><Sparkles size={14} /> Suggest fixes</button>
          ) : null}
          {recovery.status === "running" ? <div className="recovery-running"><Loader2 className="spin" size={14} /> Searching and revalidating…</div> : null}
          {recovery.status === "error" ? <p className="issue-inline">Recovery failed: {recovery.message}</p> : null}
          {recovery.status === "done" && recovery.result ? (
            recovery.result.candidates.length === 0 ? (
              <p className="field-note">No candidate improved the layout without introducing new problems ({recovery.result.evaluated} poses evaluated). Try moving a large piece manually or relaxing a clearance rule.</p>
            ) : (
              <>
                <p className="field-note">{recovery.result.candidates.length} valid option{recovery.result.candidates.length > 1 ? "s" : ""} · {recovery.result.evaluated} poses revalidated in {recovery.result.durationMs.toFixed(0)} ms{recovery.result.rejected ? ` · ${recovery.result.rejected} rejected` : ""}. Hover to preview.</p>
                {recovery.result.candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={"candidate" + (recovery.previewId === candidate.id ? " candidate--active" : "")}
                    onMouseEnter={() => previewCandidate(candidate.id)}
                    onFocus={() => previewCandidate(candidate.id)}
                    tabIndex={0}
                  >
                    <div className="candidate-head">
                      <strong>{candidate.label}</strong>
                      <span className={"pill " + (candidate.issuesAfter === 0 ? "pill--ok" : "pill--warn")}>
                        {candidate.issuesBefore} <ArrowRight size={10} /> {candidate.issuesAfter} issues
                      </span>
                    </div>
                    <ul>
                      {candidate.moves.map((move) => (
                        <li key={move.objectId}>
                          {move.name}: moved {move.distance.toFixed(2)} m
                          {Math.round(move.to.yawDegrees) !== Math.round(((move.from.yawDegrees % 360) + 360) % 360) ? `, rotated to ${move.to.yawDegrees}°` : ""}
                        </li>
                      ))}
                    </ul>
                    {candidate.remaining.length > 0 ? <p className="field-note">Still unresolved: {candidate.remaining.map((issue) => RULE_LABELS[issue.ruleId].toLowerCase()).join(", ")}.</p> : null}
                    <button type="button" className="primary-button" onClick={() => applyCandidate(candidate)}>Apply</button>
                  </div>
                ))}
                <button type="button" className="ghost-button" onClick={() => useWorkspaceStore.setState({ recovery: { status: "idle", result: null, previewId: null } })}>Dismiss suggestions</button>
              </>
            )
          ) : null}
        </section>
      ) : null}

      <ul className="issue-list">
        {issues.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              className={"issue-row" + (issue.objectIds[0] === selectedId ? " issue-row--selected" : "")}
              onClick={() => {
                selectEntity(issue.objectIds[0] ?? "");
                requestFocus();
              }}
            >
              <span className={"severity-dot severity-dot--" + issue.severity}>{issue.severity === "error" ? <CircleAlert size={13} /> : <AlertTriangle size={13} />}</span>
              <span className="issue-copy">
                <span className="issue-rule">{RULE_LABELS[issue.ruleId]} <code>{issue.ruleId}</code></span>
                <span className="issue-message">{issue.message}</span>
                {issue.measured !== undefined && issue.threshold !== undefined ? (
                  <span className="issue-measure">measured {issue.measured.toFixed(2)} m · required {issue.ruleId === "collision.overlap" || issue.ruleId === "boundary.outside-room" ? "0.00 m overlap" : issue.threshold.toFixed(2) + " m"}</span>
                ) : null}
                {issue.suggestion ? <span className="issue-suggestion">{issue.suggestion}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
