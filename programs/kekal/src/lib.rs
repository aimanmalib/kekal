pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("3dTk2T83xQWAat7iWDjfCzijdCQWhstUxFtwLk8HUo3X");

#[program]
pub mod kekal {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, params: ConfigParams) -> Result<()> {
        instructions::config::handle_init_config(ctx, params)
    }

    pub fn set_config(ctx: Context<SetConfig>, params: ConfigParams) -> Result<()> {
        instructions::config::handle_set_config(ctx, params)
    }

    pub fn create_shop(
        ctx: Context<CreateShop>,
        windows: ShopWindows,
        arbiter: Option<Pubkey>,
        profile_hash: [u8; 32],
    ) -> Result<()> {
        instructions::shop::handle_create_shop(ctx, windows, arbiter, profile_hash)
    }

    pub fn update_shop_profile(ctx: Context<OwnerShop>, profile_hash: [u8; 32]) -> Result<()> {
        instructions::shop::handle_update_shop_profile(ctx, profile_hash)
    }

    pub fn deposit(ctx: Context<MoveFunds>, amount: u64) -> Result<()> {
        instructions::funds::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<MoveFunds>, amount: u64) -> Result<()> {
        instructions::funds::handle_withdraw(ctx, amount)
    }

    pub fn issue_warranty(ctx: Context<IssueWarranty>, params: IssueParams) -> Result<()> {
        instructions::issue_warranty::handle_issue_warranty(ctx, params)
    }

    pub fn heartbeat(ctx: Context<OwnerShop>) -> Result<()> {
        instructions::shop::handle_heartbeat(ctx)
    }

    pub fn transfer_holder(ctx: Context<TransferHolder>, new_holder: Pubkey) -> Result<()> {
        instructions::holder::handle_transfer_holder(ctx, new_holder)
    }

    pub fn file_claim(ctx: Context<FileClaim>, evidence_hash: [u8; 32]) -> Result<()> {
        instructions::holder::handle_file_claim(ctx, evidence_hash)
    }

    pub fn respond_claim(
        ctx: Context<RespondClaim>,
        accept: bool,
        response_hash: [u8; 32],
    ) -> Result<()> {
        instructions::respond::handle_respond_claim(ctx, accept, response_hash)
    }

    pub fn confirm_resolved(ctx: Context<HolderClaim>) -> Result<()> {
        instructions::holder::handle_confirm_resolved(ctx)
    }

    pub fn escalate(ctx: Context<HolderClaim>) -> Result<()> {
        instructions::holder::handle_escalate(ctx)
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>, buyer_wins: bool) -> Result<()> {
        instructions::respond::handle_resolve_dispute(ctx, buyer_wins)
    }
}
