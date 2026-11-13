use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub paused: bool,
}

#[event]
pub struct ShopCreated {
    pub shop: Pubkey,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub arbiter: Pubkey,
}

#[event]
pub struct ShopProfileUpdated {
    pub shop: Pubkey,
    pub profile_hash: [u8; 32],
}

#[event]
pub struct Deposited {
    pub shop: Pubkey,
    pub amount: u64,
    pub free_balance: u64,
}

#[event]
pub struct Withdrawn {
    pub shop: Pubkey,
    pub amount: u64,
    pub free_balance: u64,
}

#[event]
pub struct WarrantyIssued {
    pub shop: Pubkey,
    pub warranty: Pubkey,
    pub id: u64,
    pub holder: Pubkey,
    pub reserve: u64,
    pub expires_at: i64,
}

#[event]
pub struct HeartbeatSent {
    pub shop: Pubkey,
    pub last_seen: i64,
}

#[event]
pub struct HolderTransferred {
    pub warranty: Pubkey,
    pub old_holder: Pubkey,
    pub new_holder: Pubkey,
}

#[event]
pub struct ClaimFiled {
    pub warranty: Pubkey,
    pub claim: Pubkey,
    pub index: u16,
    pub evidence_hash: [u8; 32],
}

#[event]
pub struct ClaimResponded {
    pub claim: Pubkey,
    pub accepted: bool,
    pub deadline: i64,
}

#[event]
pub struct ClaimStatusChanged {
    pub claim: Pubkey,
    pub status: u8,
}

/// Reserve moved from the vault to the holder; `claim_status` says why.
#[event]
pub struct ReservePaid {
    pub shop: Pubkey,
    pub warranty: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
    pub claim_status: u8,
}
