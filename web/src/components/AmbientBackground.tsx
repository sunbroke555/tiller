/** Soft coloured glows behind the glass themes (hidden in paper via CSS). */
export function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden>
      <span className="glow-a" />
      <span className="glow-b" />
      <span className="glow-c" />
    </div>
  )
}
