use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const SHOP_SEED: &[u8] = b"shop";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const WARRANTY_SEED: &[u8] = b"warranty";
#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";

/// Number of mint slots in `Config::allowed_mints`. An all-zero key marks an empty slot.
pub const ALLOWED_MINT_SLOTS: usize = 4;
