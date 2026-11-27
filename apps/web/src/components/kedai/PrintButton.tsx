"use client";

/** Opens the browser's print dialog; the print stylesheet keeps only the quote slip. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="button button-quiet" onClick={() => window.print()}>
      {label}
    </button>
  );
}
