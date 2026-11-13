use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{CONFIG_SEED, SHOP_SEED, VAULT_SEED};
use crate::error::KekalError;
use crate::events::{HeartbeatSent, ShopCreated, ShopProfileUpdated};
use crate::state::{shop_status, Config, Shop, ShopWindows};

#[derive(Accounts)]
pub struct CreateShop<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = owner,
        space = 8 + Shop::INIT_SPACE,
        seeds = [SHOP_SEED, owner.key().as_ref()],
        bump
    )]
    pub shop: Account<'info, Shop>,
    #[account(
        init,
        payer = owner,
        seeds = [VAULT_SEED, shop.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = shop,
        token::token_program = token_program
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_shop(
    ctx: Context<CreateShop>,
    windows: ShopWindows,
    arbiter: Option<Pubkey>,
    profile_hash: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, KekalError::Paused);
    let mint = ctx.accounts.mint.key();
    require!(config.is_mint_allowed(&mint), KekalError::MintNotAllowed);
    windows.validate(&config.limits)?;
    let owner = ctx.accounts.owner.key();
    let arbiter = arbiter.unwrap_or(config.default_arbiter);
    require_keys_neq!(arbiter, owner, KekalError::ArbiterIsOwner);

    let now = Clock::get()?.unix_timestamp;
    let shop = &mut ctx.accounts.shop;
    shop.set_inner(Shop {
        owner,
        mint,
        vault: ctx.accounts.vault.key(),
        arbiter,
        free_balance: 0,
        locked_balance: 0,
        response_secs: windows.response_secs,
        repair_secs: windows.repair_secs,
        dispute_secs: windows.dispute_secs,
        heartbeat_secs: windows.heartbeat_secs,
        grace_secs: windows.grace_secs,
        last_seen: now,
        status: shop_status::ACTIVE,
        dormant_at: 0,
        next_warranty_id: 0,
        active_warranties: 0,
        open_claims: 0,
        issued: 0,
        paid_count: 0,
        paid_amount: 0,
        released_amount: 0,
        flags: 0,
        profile_hash,
        created_at: now,
        bump: ctx.bumps.shop,
        vault_bump: ctx.bumps.vault,
    });
    emit!(ShopCreated {
        shop: shop.key(),
        owner,
        mint,
        arbiter
    });
    Ok(())
}

/// Accounts for owner-only actions that touch nothing but the shop record.
#[derive(Accounts)]
pub struct OwnerShop<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [SHOP_SEED, owner.key().as_ref()], bump = shop.bump, has_one = owner)]
    pub shop: Account<'info, Shop>,
}

pub fn handle_update_shop_profile(ctx: Context<OwnerShop>, profile_hash: [u8; 32]) -> Result<()> {
    let shop = &mut ctx.accounts.shop;
    shop.profile_hash = profile_hash;
    shop.last_seen = Clock::get()?.unix_timestamp;
    emit!(ShopProfileUpdated {
        shop: shop.key(),
        profile_hash
    });
    Ok(())
}

/// A late heartbeat still counts until someone declares the shop dormant.
pub fn handle_heartbeat(ctx: Context<OwnerShop>) -> Result<()> {
    let shop = &mut ctx.accounts.shop;
    require!(shop.status == shop_status::ACTIVE, KekalError::ShopDormant);
    shop.last_seen = Clock::get()?.unix_timestamp;
    emit!(HeartbeatSent {
        shop: shop.key(),
        last_seen: shop.last_seen
    });
    Ok(())
}
