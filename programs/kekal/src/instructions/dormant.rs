use anchor_lang::prelude::*;

use crate::constants::CLAIM_SEED;
use crate::error::KekalError;
use crate::events::{ClaimStatusChanged, ShopDeclaredDormant, WarrantyReleased};
use crate::instructions::payout::*;
use crate::state::{claim_status, shop_status, warranty_status, Claim, Shop, Warranty};

#[derive(Accounts)]
pub struct DeclareDormant<'info> {
    #[account(mut)]
    pub shop: Account<'info, Shop>,
}

/// Anyone may mark a shop dormant once its heartbeat and grace period have both passed.
pub fn handle_declare_dormant(ctx: Context<DeclareDormant>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let shop = &mut ctx.accounts.shop;
    require!(shop.status == shop_status::ACTIVE, KekalError::ShopDormant);
    require!(now > shop.silence_deadline()?, KekalError::ShopStillActive);
    shop.status = shop_status::DORMANT;
    shop.dormant_at = now;
    emit!(ShopDeclaredDormant {
        shop: shop.key(),
        last_seen: shop.last_seen,
        dormant_at: now
    });
    Ok(())
}

/// Pays a warranty of a dormant shop to its holder. A Claimed warranty must pass its open claim,
/// which ends as PaidOrphan; an Active warranty passes no claim.
#[derive(Accounts)]
pub struct ClaimOrphan<'info> {
    #[account(mut)]
    pub shop: Account<'info, Shop>,
    #[account(mut, has_one = shop)]
    pub warranty: Account<'info, Warranty>,
    #[account(
        mut,
        has_one = warranty,
        seeds = [CLAIM_SEED, warranty.key().as_ref(), &warranty.open_claim.to_le_bytes()],
        bump = claim.bump
    )]
    pub claim: Option<Account<'info, Claim>>,
    pub payout: PayoutAccounts<'info>,
}

pub fn handle_claim_orphan(ctx: Context<ClaimOrphan>) -> Result<()> {
    let a = ctx.accounts;
    require!(
        a.shop.status == shop_status::DORMANT,
        KekalError::ShopNotDormant
    );
    require!(
        a.warranty.expires_at >= a.shop.dormant_at,
        KekalError::ExpiredBeforeDormant
    );
    let claim_open = match a.warranty.status {
        warranty_status::ACTIVE => {
            require!(a.claim.is_none(), KekalError::AccountMismatch);
            false
        }
        warranty_status::CLAIMED => {
            let c = a.claim.as_mut().ok_or(KekalError::AccountMismatch)?;
            c.status = claim_status::PAID_ORPHAN;
            emit!(ClaimStatusChanged {
                claim: c.key(),
                status: c.status
            });
            true
        }
        _ => return err!(KekalError::WarrantyNotActive),
    };
    a.payout.pay(
        &mut a.shop,
        &mut a.warranty,
        claim_open,
        claim_status::PAID_ORPHAN,
    )
}

#[derive(Accounts)]
pub struct ReleaseExpired<'info> {
    #[account(mut)]
    pub shop: Account<'info, Shop>,
    #[account(mut, has_one = shop)]
    pub warranty: Account<'info, Warranty>,
}

/// An expired warranty with no open claim returns its reserve to the shop's free balance. A
/// dormant shop's warranty that was still live when the shop went silent belongs to the holder.
pub fn handle_release_expired(ctx: Context<ReleaseExpired>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let shop = &mut ctx.accounts.shop;
    let w = &mut ctx.accounts.warranty;
    require!(
        w.status == warranty_status::ACTIVE,
        KekalError::WarrantyNotActive
    );
    require!(now > w.expires_at, KekalError::WarrantyNotExpired);
    require!(
        !(shop.status == shop_status::DORMANT && w.expires_at >= shop.dormant_at),
        KekalError::OwedToHolder
    );
    let amount = w.reserve;
    let overflow = || error!(KekalError::Overflow);
    shop.locked_balance = shop
        .locked_balance
        .checked_sub(amount)
        .ok_or_else(overflow)?;
    shop.free_balance = shop.free_balance.checked_add(amount).ok_or_else(overflow)?;
    shop.active_warranties = shop.active_warranties.checked_sub(1).ok_or_else(overflow)?;
    shop.released_amount = shop
        .released_amount
        .checked_add(amount)
        .ok_or_else(overflow)?;
    w.status = warranty_status::RELEASED;
    emit!(WarrantyReleased {
        shop: shop.key(),
        warranty: w.key(),
        amount
    });
    Ok(())
}
