/**
 * Orbis mark: an orbit that spirals in to a home. Drawn as SVG so it stays crisp from 16 px favicons to large
 * headers, and uses currentColor so it can sit on purple, white or dark backgrounds.
 */
export function OrbisMark({ size = 24, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 120 120" fill="none" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <g stroke="currentColor" strokeWidth="7.3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="60" cy="60" r="50" />
        <path d="M100.9 32.2 C94.5 28.6 84.5 28.8 74 28.8 C58 28.8 46.2 41.2 46.2 57.7 C46.2 70.2 55 78.5 66.7 78.5 H70" />
      </g>
      <path fill="currentColor" fillRule="evenodd" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" d="M66.5 81.4 V59.4 L78.5 49.4 L90.4 59.4 V81.4 Z M72.4 63.1 V73.3 H84.3 V63.1 Z" />
    </svg>
  );
}

/** Mark + wordmark. `tile` puts the mark on the purple brand tile (sidebar, auth screens). */
export function OrbisLogo({ size = 28, tile = false, wordmark = true, className }: { size?: number; tile?: boolean; wordmark?: boolean; className?: string }) {
  return (
    <span className={"orbis-logo" + (className ? " " + className : "")}>
      {tile ? <span className="orbis-tile" style={{ width: size + 12, height: size + 12 }}><OrbisMark size={size} /></span> : <OrbisMark size={size} className="orbis-mark" />}
      {wordmark ? <span className="orbis-word">ORBIS</span> : null}
    </span>
  );
}
