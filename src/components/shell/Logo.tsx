export function Logo({ size = 26 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="NexusIDE logo" className="logo">
      <rect width="64" height="64" rx="14" fill="var(--surface-2)" />
      <path
        d="M17 47V17l30 30V17"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="47" cy="17" r="3.4" fill="var(--text)" />
    </svg>
  );
}
