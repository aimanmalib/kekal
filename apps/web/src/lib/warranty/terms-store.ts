// Terms text for the warranty readers. A store that cannot open or answer reads as "no terms kept here".
import { dataStore } from "../data";

export function termsStore(): { getWarrantyTerms(pda: string): Promise<string | null> } {
  return {
    getWarrantyTerms: async (pda) => {
      try {
        return await dataStore().getWarrantyTerms(pda);
      } catch {
        return null;
      }
    },
  };
}
