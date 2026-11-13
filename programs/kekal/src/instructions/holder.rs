use anchor_lang::prelude::*;

use crate::constants::{CLAIM_SEED, CONFIG_SEED};
use crate::error::KekalError;
use crate::events::{ClaimFiled, ClaimStatusChanged, HolderTransferred};
use crate::instructions::payout::close_open_claim;
use crate::state::{claim_status, shop_status, warranty_status, Claim, Config, Shop, Warranty};

#[derive(Accounts)]
pub struct TransferHolder<'info> {
    pub holder: Signer<'info>,
    #[account(mut, has_one = holder @ KekalError::NotHolder)]
    pub warranty: Account<'info, Warranty>,
}

pub fn handle_transfer_holder(ctx: Context<TransferHolder>, new_holder: Pubkey) -> Result<()> {
    let w = &mut ctx.accounts.warranty;
    require!(
        w.status == warranty_status::ACTIVE || w.status == warranty_status::CLAIMED,
        KekalError::WarrantyNotActive
    );
    require!(
        new_holder != Pubkey::default() && new_holder != w.holder,
        KekalError::InvalidHolder
    );
    let old_holder = w.holder;
    w.holder = new_holder;
    emit!(HolderTransferred {
        warranty: w.key(),
        old_holder,
        new_holder
    });
    Ok(())
}

/// The holder signs; a separate payer (the relayer) pays the fee and the claim record's rent.
#[derive(Accounts)]
pub struct FileClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub holder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub shop: Account<'info, Shop>,
    #[account(mut, has_one = holder @ KekalError::NotHolder, has_one = shop)]
    pub warranty: Account<'info, Warranty>,
    #[account(
        init,
        payer = payer,
        space = 8 + Claim::INIT_SPACE,
        seeds = [CLAIM_SEED, warranty.key().as_ref(), &warranty.claim_count.to_le_bytes()],
        bump
    )]
    pub claim: Account<'info, Claim>,
    pub system_program: Program<'info, System>,
}

pub fn handle_file_claim(ctx: Context<FileClaim>, evidence_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let limits = &ctx.accounts.config.limits;
    let shop = &mut ctx.accounts.shop;
    let w = &mut ctx.accounts.warranty;
    require!(
        w.status == warranty_status::ACTIVE,
        KekalError::WarrantyNotActive
    );
    require!(now <= w.expires_at, KekalError::WarrantyExpired);
    require!(shop.status == shop_status::ACTIVE, KekalError::ShopDormant);
    require!(
        w.claim_count < u16::from(limits.max_claims_per_warranty),
        KekalError::TooManyClaims
    );
    if w.claim_count > 0 {
        let ready = w
            .last_claim_closed_at
            .checked_add(limits.claim_cooldown_secs)
            .ok_or(KekalError::Overflow)?;
        require!(now >= ready, KekalError::ClaimCooldown);
    }

    let index = w.claim_count;
    w.claim_count = index.checked_add(1).ok_or(KekalError::Overflow)?;
    w.open_claim = index;
    w.status = warranty_status::CLAIMED;
    shop.open_claims = shop
        .open_claims
        .checked_add(1)
        .ok_or(KekalError::Overflow)?;

    let warranty_key = w.key();
    let claim = &mut ctx.accounts.claim;
    claim.set_inner(Claim {
        warranty: warranty_key,
        index,
        evidence_hash,
        filed_at: now,
        status: claim_status::PENDING,
        response_hash: [0; 32],
        responded_at: 0,
        repair_deadline: 0,
        dispute_deadline: 0,
        escalated_at: 0,
        attest_verdict: 0,
        attest_at: 0,
        rent_payer: ctx.accounts.payer.key(),
        bump: ctx.bumps.claim,
    });
    emit!(ClaimFiled {
        warranty: warranty_key,
        claim: claim.key(),
        index,
        evidence_hash
    });
    Ok(())
}

/// Holder actions on the open claim (`confirm_resolved`, `escalate`).
#[derive(Accounts)]
pub struct HolderClaim<'info> {
    pub holder: Signer<'info>,
    #[account(mut)]
    pub shop: Account<'info, Shop>,
    #[account(mut, has_one = holder @ KekalError::NotHolder, has_one = shop)]
    pub warranty: Account<'info, Warranty>,
    #[account(mut, has_one = warranty)]
    pub claim: Account<'info, Claim>,
}

pub fn handle_confirm_resolved(ctx: Context<HolderClaim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    require!(
        a.claim.status == claim_status::ACCEPTED,
        KekalError::InvalidClaimState
    );
    a.claim.status = claim_status::RESOLVED;
    close_open_claim(&mut a.shop, &mut a.warranty, now)?;
    emit!(ClaimStatusChanged {
        claim: a.claim.key(),
        status: a.claim.status
    });
    Ok(())
}

/// Rejected: escalate up to the dispute deadline. Accepted but not repaired: escalate after the
/// repair deadline and up to `dispute_secs` later, when `close_stale` takes over (ADR 0003).
pub fn handle_escalate(ctx: Context<HolderClaim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let c = &mut a.claim;
    let allowed = match c.status {
        claim_status::REJECTED => now <= c.dispute_deadline,
        claim_status::ACCEPTED => {
            let last = c
                .repair_deadline
                .checked_add(a.shop.dispute_secs)
                .ok_or(KekalError::Overflow)?;
            now > c.repair_deadline && now <= last
        }
        _ => return err!(KekalError::InvalidClaimState),
    };
    require!(allowed, KekalError::EscalationNotAllowed);
    c.status = claim_status::DISPUTED;
    c.escalated_at = now;
    emit!(ClaimStatusChanged {
        claim: c.key(),
        status: c.status
    });
    Ok(())
}
