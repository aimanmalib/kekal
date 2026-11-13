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
}
