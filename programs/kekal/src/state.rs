use anchor_lang::prelude::*;

use crate::constants::ALLOWED_MINT_SLOTS;
use crate::error::KekalError;

/// Limits the admin sets. Shops pick their own windows inside these limits at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct ConfigLimits {
    pub min_response_secs: i64,
    pub max_response_secs: i64,
    pub min_repair_secs: i64,
    pub max_repair_secs: i64,
    pub min_dispute_secs: i64,
    pub max_dispute_secs: i64,
    pub min_heartbeat_secs: i64,
    pub max_heartbeat_secs: i64,
    pub max_grace_secs: i64,
    pub min_term_secs: i64,
    pub max_term_secs: i64,
    pub dispute_timeout_secs: i64,
    pub claim_cooldown_secs: i64,
    pub max_claims_per_warranty: u8,
}

impl ConfigLimits {
    pub fn validate(&self) -> Result<()> {
        let ranges = [
            (self.min_response_secs, self.max_response_secs),
            (self.min_repair_secs, self.max_repair_secs),
            (self.min_dispute_secs, self.max_dispute_secs),
            (self.min_heartbeat_secs, self.max_heartbeat_secs),
            (self.min_term_secs, self.max_term_secs),
        ];
        for (min, max) in ranges {
            require!(min > 0 && min <= max, KekalError::InvalidLimits);
        }
        require!(self.max_grace_secs >= 0, KekalError::InvalidLimits);
        require!(self.dispute_timeout_secs > 0, KekalError::InvalidLimits);
        require!(self.claim_cooldown_secs >= 0, KekalError::InvalidLimits);
        require!(self.max_claims_per_warranty > 0, KekalError::InvalidLimits);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub default_arbiter: Pubkey,
    pub assessor: Pubkey,
    pub limits: ConfigLimits,
    pub allowed_mints: [Pubkey; ALLOWED_MINT_SLOTS],
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub fn is_mint_allowed(&self, mint: &Pubkey) -> bool {
        *mint != Pubkey::default() && self.allowed_mints.contains(mint)
    }
}

pub mod shop_status {
    pub const ACTIVE: u8 = 0;
    pub const DORMANT: u8 = 1;
}

#[account]
#[derive(InitSpace)]
pub struct Shop {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub arbiter: Pubkey,
    pub free_balance: u64,
    pub locked_balance: u64,
    pub response_secs: i64,
    pub repair_secs: i64,
    pub dispute_secs: i64,
    pub heartbeat_secs: i64,
    pub grace_secs: i64,
    pub last_seen: i64,
    pub status: u8,
    pub dormant_at: i64,
    pub next_warranty_id: u64,
    pub active_warranties: u32,
    pub open_claims: u32,
    pub issued: u64,
    pub paid_count: u64,
    pub paid_amount: u64,
    pub released_amount: u64,
    /// Bit 0: auto-accept a claim when the assessor attests it is covered (S2).
    pub flags: u8,
    pub profile_hash: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Shop {
    /// Last moment the shop may still act before anyone can declare it dormant.
    pub fn silence_deadline(&self) -> Result<i64> {
        self.last_seen
            .checked_add(self.heartbeat_secs)
            .and_then(|t| t.checked_add(self.grace_secs))
            .ok_or_else(|| error!(KekalError::Overflow))
    }
}

/// Shop windows chosen at creation; they cannot change afterwards.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct ShopWindows {
    pub response_secs: i64,
    pub repair_secs: i64,
    pub dispute_secs: i64,
    pub heartbeat_secs: i64,
    pub grace_secs: i64,
}

impl ShopWindows {
    pub fn validate(&self, l: &ConfigLimits) -> Result<()> {
        let within = |v: i64, min: i64, max: i64| v >= min && v <= max;
        require!(
            within(self.response_secs, l.min_response_secs, l.max_response_secs),
            KekalError::ResponseWindowOutOfRange
        );
        require!(
            within(self.repair_secs, l.min_repair_secs, l.max_repair_secs),
            KekalError::RepairWindowOutOfRange
        );
        require!(
            within(self.dispute_secs, l.min_dispute_secs, l.max_dispute_secs),
            KekalError::DisputeWindowOutOfRange
        );
        require!(
            within(
                self.heartbeat_secs,
                l.min_heartbeat_secs,
                l.max_heartbeat_secs
            ),
            KekalError::HeartbeatWindowOutOfRange
        );
        require!(
            within(self.grace_secs, 0, l.max_grace_secs),
            KekalError::GraceOutOfRange
        );
        Ok(())
    }
}

pub mod warranty_status {
    pub const ACTIVE: u8 = 0;
    pub const CLAIMED: u8 = 1;
    pub const PAID_OUT: u8 = 2;
    pub const RELEASED: u8 = 3;
}

#[account]
#[derive(InitSpace)]
pub struct Warranty {
    pub shop: Pubkey,
    pub id: u64,
    pub holder: Pubkey,
    pub reserve: u64,
    pub terms_hash: [u8; 32],
    pub product_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub status: u8,
    pub claim_count: u16,
    pub open_claim: u16,
    pub last_claim_closed_at: i64,
    pub bump: u8,
}

pub mod claim_status {
    pub const PENDING: u8 = 0;
    pub const ACCEPTED: u8 = 1;
    pub const REJECTED: u8 = 2;
    pub const DISPUTED: u8 = 3;
    pub const RESOLVED: u8 = 4;
    pub const PAID_TIMEOUT: u8 = 5;
    pub const PAID_ARBITER: u8 = 6;
    pub const DISMISSED: u8 = 7;
    pub const CLOSED: u8 = 8;
    pub const PAID_ORPHAN: u8 = 9;
    pub const PAID_STALE: u8 = 10;
}

#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub warranty: Pubkey,
    pub index: u16,
    pub evidence_hash: [u8; 32],
    pub filed_at: i64,
    pub status: u8,
    pub response_hash: [u8; 32],
    pub responded_at: i64,
    pub repair_deadline: i64,
    pub dispute_deadline: i64,
    pub escalated_at: i64,
    pub attest_verdict: u8,
    pub attest_at: i64,
    pub rent_payer: Pubkey,
    pub bump: u8,
}
