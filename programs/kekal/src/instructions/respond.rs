use anchor_lang::prelude::*;

use crate::constants::SHOP_SEED;
use crate::error::KekalError;
use crate::events::{ClaimResponded, ClaimStatusChanged};
use crate::instructions::payout::*;
use crate::state::{claim_status, shop_status, Claim, Shop, Warranty};

#[derive(Accounts)]
pub struct RespondClaim<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [SHOP_SEED, owner.key().as_ref()], bump = shop.bump, has_one = owner)]
    pub shop: Account<'info, Shop>,
    #[account(has_one = shop)]
    pub warranty: Account<'info, Warranty>,
    #[account(mut, has_one = warranty)]
    pub claim: Account<'info, Claim>,
}

pub fn handle_respond_claim(
    ctx: Context<RespondClaim>,
    accept: bool,
    response_hash: [u8; 32],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let shop = &mut ctx.accounts.shop;
    let c = &mut ctx.accounts.claim;
    require!(shop.status == shop_status::ACTIVE, KekalError::ShopDormant);
    require!(
        c.status == claim_status::PENDING,
        KekalError::InvalidClaimState
    );
    let window_end = c
        .filed_at
        .checked_add(shop.response_secs)
        .ok_or(KekalError::Overflow)?;
    require!(now <= window_end, KekalError::ResponseWindowClosed);

    let (status, window) = if accept {
        (claim_status::ACCEPTED, shop.repair_secs)
    } else {
        (claim_status::REJECTED, shop.dispute_secs)
    };
    let deadline = now.checked_add(window).ok_or(KekalError::Overflow)?;
    if accept {
        c.repair_deadline = deadline;
    } else {
        c.dispute_deadline = deadline;
    }
    c.status = status;
    c.response_hash = response_hash;
    c.responded_at = now;
    shop.last_seen = now;
    emit!(ClaimResponded {
        claim: c.key(),
        accepted: accept,
        deadline
    });
    Ok(())
}

/// The shop's named arbiter decides a disputed claim. Any payer (the relayer) may cover fees.
#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub arbiter: Signer<'info>,
    #[account(mut, has_one = arbiter @ KekalError::NotArbiter)]
    pub shop: Account<'info, Shop>,
    #[account(mut, has_one = shop)]
    pub warranty: Account<'info, Warranty>,
    #[account(mut, has_one = warranty)]
    pub claim: Account<'info, Claim>,
    pub payout: PayoutAccounts<'info>,
}

pub fn handle_resolve_dispute(ctx: Context<ResolveDispute>, buyer_wins: bool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    require!(
        a.claim.status == claim_status::DISPUTED,
        KekalError::InvalidClaimState
    );
    if buyer_wins {
        a.claim.status = claim_status::PAID_ARBITER;
        a.payout.pay(
            &mut a.shop,
            &mut a.warranty,
            true,
            claim_status::PAID_ARBITER,
        )?;
    } else {
        a.claim.status = claim_status::DISMISSED;
        close_open_claim(&mut a.shop, &mut a.warranty, now)?;
    }
    emit!(ClaimStatusChanged {
        claim: a.claim.key(),
        status: a.claim.status
    });
    Ok(())
}
