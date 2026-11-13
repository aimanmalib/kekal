use anchor_lang::prelude::*;

#[error_code]
pub enum KekalError {
    #[msg("A minimum limit is zero or greater than its maximum")]
    InvalidLimits,
    #[msg("Program is paused for new shops and new warranties")]
    Paused,
    #[msg("Mint is not in the allowed list")]
    MintNotAllowed,
    #[msg("The arbiter cannot be the shop owner")]
    ArbiterIsOwner,
    #[msg("Response window is outside the configured limits")]
    ResponseWindowOutOfRange,
    #[msg("Repair window is outside the configured limits")]
    RepairWindowOutOfRange,
    #[msg("Dispute window is outside the configured limits")]
    DisputeWindowOutOfRange,
    #[msg("Heartbeat window is outside the configured limits")]
    HeartbeatWindowOutOfRange,
    #[msg("Grace period is above the configured maximum")]
    GraceOutOfRange,
    #[msg("Warranty term is outside the configured limits")]
    TermOutOfRange,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Amount is larger than the shop's free balance")]
    InsufficientFreeBalance,
    #[msg("Shop is dormant")]
    ShopDormant,
    #[msg("Shop missed its heartbeat window and cannot issue warranties")]
    HeartbeatLapsed,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Signer is not the warranty holder")]
    NotHolder,
    #[msg("New holder must be a real key different from the current one")]
    InvalidHolder,
    #[msg("Warranty is not in a state that allows this action")]
    WarrantyNotActive,
    #[msg("Warranty has expired")]
    WarrantyExpired,
    #[msg("Warranty reached the maximum number of claims")]
    TooManyClaims,
    #[msg("A new claim must wait for the cooldown after the last one closed")]
    ClaimCooldown,
    #[msg("Claim is not in a state that allows this action")]
    InvalidClaimState,
    #[msg("Response window has closed")]
    ResponseWindowClosed,
    #[msg("Escalation is not allowed at this time")]
    EscalationNotAllowed,
    #[msg("Signer is not the shop's arbiter")]
    NotArbiter,
    #[msg("Account does not belong to this shop or warranty")]
    AccountMismatch,
}
