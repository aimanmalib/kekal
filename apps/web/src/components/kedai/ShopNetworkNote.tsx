import Link from "next/link";
import { fill, type MessageKey, type Translate } from "@/lib/i18n";

/** The network line on /kedai: where the board runs and the no-wallet demo, or, while the program is missing, that nothing can be sent. */
export function ShopNetworkNote({ t, cluster }: { t: Translate; cluster: { name: string; deployed: boolean } }) {
  const network = t(`cluster.${cluster.name}` as MessageKey);
  if (!cluster.deployed) return <p className="note">{fill(t("kedai.pending"), { network })}</p>;
  return (
    <p className="note">
      {fill(t("kedai.devnet"), { network })} <Link href="/demo">{t("wallet.tryDemo")}</Link>
    </p>
  );
}
