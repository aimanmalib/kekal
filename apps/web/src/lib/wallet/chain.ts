// Wallet Standard chain id of a cluster, e.g. "solana:devnet". Kept apart from ./standard so server pages can import it.
export const chainId = (cluster: string): string => `solana:${cluster}`;
