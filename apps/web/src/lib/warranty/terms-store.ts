// Terms text for the warranty readers. A store that cannot open (no data folder) reads as "no terms kept here".
import { dataStore } from "../data";

export function termsStore(): { getWarrantyTerms(pda: string): string | null } {
  try {
    return dataStore();
  } catch {
    return { getWarrantyTerms: () => null };
  }
}
