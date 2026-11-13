use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::SHOP_SEED;
use crate::error::KekalError;
use crate::events::{Deposited, Withdrawn};
use crate::state::Shop;

/// Moves tokens between the owner's own token account and the shop vault.
#[derive(Accounts)]
pub struct MoveFunds<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [SHOP_SEED, owner.key().as_ref()],
        bump = shop.bump,
        has_one = owner,
        has_one = mint,
        has_one = vault
    )]
    pub shop: Account<'info, Shop>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_deposit(ctx: Context<MoveFunds>, amount: u64) -> Result<()> {
    require!(amount > 0, KekalError::ZeroAmount);
    let a = &ctx.accounts;
    token::transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.owner_token.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.vault.to_account_info(),
                authority: a.owner.to_account_info(),
            },
        ),
        amount,
        a.mint.decimals,
    )?;
    let shop = &mut ctx.accounts.shop;
    shop.free_balance = shop
        .free_balance
        .checked_add(amount)
        .ok_or(KekalError::Overflow)?;
    shop.last_seen = Clock::get()?.unix_timestamp;
    emit!(Deposited {
        shop: shop.key(),
        amount,
        free_balance: shop.free_balance
    });
    Ok(())
}

/// Allowed while dormant: only the free balance ever leaves, never reserves.
pub fn handle_withdraw(ctx: Context<MoveFunds>, amount: u64) -> Result<()> {
    require!(amount > 0, KekalError::ZeroAmount);
    let a = &ctx.accounts;
    require!(
        amount <= a.shop.free_balance,
        KekalError::InsufficientFreeBalance
    );
    let owner_key = a.owner.key();
    let seeds: &[&[u8]] = &[SHOP_SEED, owner_key.as_ref(), &[a.shop.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.vault.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.owner_token.to_account_info(),
                authority: a.shop.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        a.mint.decimals,
    )?;
    let shop = &mut ctx.accounts.shop;
    shop.free_balance -= amount;
    shop.last_seen = Clock::get()?.unix_timestamp;
    emit!(Withdrawn {
        shop: shop.key(),
        amount,
        free_balance: shop.free_balance
    });
    Ok(())
}
