import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

/** A drawn phone around live page content: what a buyer sees after scanning the card's QR code. Pure CSS, no image. */
export function PhoneFrame(props: { label: string; title: string; caption?: string; children: ReactNode }) {
  const { label, title, caption, children } = props;
  return (
    <div className="phone-wrap">
      <div className="phone" role="group" aria-label={label}>
        <div className="phone-screen">
          <p className="phone-bar" aria-hidden="true">
            <BrandMark />
            <span>{title}</span>
          </p>
          {children}
        </div>
      </div>
      {caption ? <p className="phone-caption">{caption}</p> : null}
    </div>
  );
}
