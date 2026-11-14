use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::error::KekalError;
use crate::events::ClaimStatusChanged;
use crate::instructions::payout::*;
use crate::state::{claim_status, Claim, Config, Shop, Warranty};

/// Permissionless payout of an open claim (`settle_unanswered`, `settle_stale_dispute`). Anyone
/// may send it; the payer covers the fee and, if needed, the holder's token account rent.
#[derive(Accounts)]
pub struct SettleClaim<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub shop: Account<'info, Shop>,
    #[account(mut, has_one = shop)]
    pub warranty: Account<'info, Warranty>,
    #[account(mut, has_one = warranty)]
    pub claim: Account<'info, Claim>,
    pub payout: PayoutAccounts<'info>,
}

impl<'info> SettleClaim<'info> {
    fn pay_claim(&mut self, status: u8) -> Result<()> {
        self.claim.status = status;
        self.payout
            .pay(&mut self.shop, &mut self.warranty, true, status)?;
        emit!(ClaimStatusChanged {
            claim: self.claim.key(),
            status
        });
        Ok(())
    }
}

/// The shop let the response window pass: the holder is paid in full.
pub fn handle_settle_unanswered(ctx: Context<SettleClaim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    require!(
        a.claim.status == claim_status::PENDING,
        KekalError::InvalidClaimState
    );
    let window_end = a
        .claim
        .filed_at
        .checked_add(a.shop.response_secs)
        .ok_or(KekalError::Overflow)?;
    require!(now > window_end, KekalError::WindowStillOpen);
    a.pay_claim(claim_status::PAID_TIMEOUT)
}

/// The arbiter did not decide within the program-wide timeout: the holder is paid in full.
pub fn handle_settle_stale_dispute(ctx: Context<SettleClaim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    require!(
        a.claim.status == claim_status::DISPUTED,
        KekalError::InvalidClaimState
    );
    let timeout_end = a
        .claim
        .escalated_at
        .checked_add(a.config.limits.dispute_timeout_secs)
        .ok_or(KekalError::Overflow)?;
    require!(now > timeout_end, KekalError::WindowStillOpen);
    a.pay_claim(claim_status::PAID_STALE)
}

/// Ends a claim nobody acted on, without payment.
#[derive(Accounts)]
pub struct CloseStale<'info> {
    #[account(mut)]
    pub shop: Account<'info, Shop>,
    #[account(mut, has_one = shop)]
    pub warranty: Account<'info, Warranty>,
    #[account(mut, has_one = warranty)]
    pub claim: Account<'info, Claim>,
}

/// Rejected and the holder did not escalate in time → Closed. Accepted and the holder neither
/// confirmed nor escalated within `dispute_secs` after the repair deadline → Resolved.
pub fn handle_close_stale(ctx: Context<CloseStale>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let c = &mut a.claim;
    let (deadline, next) = match c.status {
        claim_status::REJECTED => (c.dispute_deadline, claim_status::CLOSED),
        claim_status::ACCEPTED => (
            c.repair_deadline
                .checked_add(a.shop.dispute_secs)
                .ok_or(KekalError::Overflow)?,
            claim_status::RESOLVED,
        ),
        _ => return err!(KekalError::InvalidClaimState),
    };
    require!(now > deadline, KekalError::WindowStillOpen);
    c.status = next;
    close_open_claim(&mut a.shop, &mut a.warranty, now)?;
    emit!(ClaimStatusChanged {
        claim: c.key(),
        status: next
    });
    Ok(())
}
