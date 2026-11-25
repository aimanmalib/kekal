/** The Kekal mark (brand/logo.svg simplified for small sizes), drawn in the page tokens so it never drifts from the CSS. */
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="brand-mark-ground" width="32" height="32" rx="7" />
      <path className="brand-mark-letter" d="M9 6h4v6.6L18.4 6h5l-7.1 7.6L23.8 22h-5.1L13 16.6V22H9z" />
      <rect className="brand-mark-bar" x="10" y="25" width="12" height="3" rx="1.5" />
    </svg>
  );
}
