use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, SHOP_SEED, WARRANTY_SEED};
use crate::error::KekalError;
use crate::events::WarrantyIssued;
use crate::state::{shop_status, warranty_status, Config, Shop, Warranty};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct IssueParams {
    pub holder: Pubkey,
    pub reserve: u64,
    pub term_secs: i64,
    pub terms_hash: [u8; 32],
    pub product_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct IssueWarranty<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SHOP_SEED, owner.key().as_ref()], bump = shop.bump, has_one = owner)]
    pub shop: Account<'info, Shop>,
    #[account(
        init,
        payer = owner,
        space = 8 + Warranty::INIT_SPACE,
        seeds = [WARRANTY_SEED, shop.key().as_ref(), &shop.next_warranty_id.to_le_bytes()],
        bump
    )]
    pub warranty: Account<'info, Warranty>,
    pub system_program: Program<'info, System>,
}

pub fn handle_issue_warranty(ctx: Context<IssueWarranty>, p: IssueParams) -> Result<()> {
    let limits = &ctx.accounts.config.limits;
    require!(!ctx.accounts.config.paused, KekalError::Paused);
    let now = Clock::get()?.unix_timestamp;
    let shop = &mut ctx.accounts.shop;
    require!(shop.status == shop_status::ACTIVE, KekalError::ShopDormant);
    require!(now <= shop.silence_deadline()?, KekalError::HeartbeatLapsed);
    require!(p.reserve > 0, KekalError::ZeroAmount);
    require!(
        p.reserve <= shop.free_balance,
        KekalError::InsufficientFreeBalance
    );
    require!(
        p.term_secs >= limits.min_term_secs && p.term_secs <= limits.max_term_secs,
        KekalError::TermOutOfRange
    );
    let expires_at = now.checked_add(p.term_secs).ok_or(KekalError::Overflow)?;

    let id = shop.next_warranty_id;
    shop.free_balance -= p.reserve;
    shop.locked_balance = shop
        .locked_balance
        .checked_add(p.reserve)
        .ok_or(KekalError::Overflow)?;
    shop.next_warranty_id = id.checked_add(1).ok_or(KekalError::Overflow)?;
    shop.active_warranties = shop
        .active_warranties
        .checked_add(1)
        .ok_or(KekalError::Overflow)?;
    shop.issued = shop.issued.checked_add(1).ok_or(KekalError::Overflow)?;
    shop.last_seen = now;

    let shop_key = shop.key();
    let warranty = &mut ctx.accounts.warranty;
    warranty.set_inner(Warranty {
        shop: shop_key,
        id,
        holder: p.holder,
        reserve: p.reserve,
        terms_hash: p.terms_hash,
        product_hash: p.product_hash,
        issued_at: now,
        expires_at,
        status: warranty_status::ACTIVE,
        claim_count: 0,
        open_claim: 0,
        last_claim_closed_at: 0,
        bump: ctx.bumps.warranty,
    });
    emit!(WarrantyIssued {
        shop: shop_key,
        warranty: warranty.key(),
        id,
        holder: p.holder,
        reserve: p.reserve,
        expires_at
    });
    Ok(())
}
