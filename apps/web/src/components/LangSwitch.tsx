"use client";

import { useRouter } from "next/navigation";

interface Props {
  current: string;
  options: { value: string; label: string }[];
  label: string;
  cookie: string;
  maxAgeDays: number;
}

export function LangSwitch({ current, options, label, cookie, maxAgeDays }: Props) {
  const router = useRouter();
  const choose = (value: string) => {
    document.cookie = `${cookie}=${value}; path=/; max-age=${maxAgeDays * 86400}; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="lang" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.value}
          aria-pressed={o.value === current}
          onClick={() => choose(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
