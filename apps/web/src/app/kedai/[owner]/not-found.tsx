import { SiteFrame } from "@/components/SiteFrame";
import { ShopRecordMissing } from "@/components/kedai/ShopRecord";
import { translator } from "@/lib/i18n";
import { requestLang } from "@/lib/request-lang";

/** A bad address or no shop under it: a designed page with status 404. */
export default async function ShopNotFound() {
  const lang = await requestLang();
  const t = translator(lang);
  return (
    <SiteFrame lang={lang} t={t}>
      <ShopRecordMissing reason="not_found" t={t} />
    </SiteFrame>
  );
}
