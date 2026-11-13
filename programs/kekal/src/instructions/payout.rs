use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::SHOP_SEED;
use crate::error::KekalError;
use crate::events::ReservePaid;
use crate::state::{warranty_status, Shop, Warranty};

/// Accounts every "pay the holder" path needs. The holder's associated token account is created
/// on demand and the transaction's payer covers its rent.
#[derive(Accounts)]
pub struct PayoutAccounts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: only the authority of `holder_token`; `pay` checks it equals `warranty.holder`.
    pub holder: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = holder,
        associated_token::token_program = token_program
    )]
    pub holder_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> PayoutAccounts<'info> {
    /// Sends the full reserve to the holder and marks the warranty paid out. The caller sets the
    /// claim status; `claim_open` says whether an open claim closes with this payment.
    pub fn pay(
        &self,
        shop: &mut Account<'info, Shop>,
        warranty: &mut Account<'info, Warranty>,
        claim_open: bool,
        claim_status: u8,
    ) -> Result<()> {
        require_keys_eq!(self.mint.key(), shop.mint, KekalError::AccountMismatch);
        require_keys_eq!(self.vault.key(), shop.vault, KekalError::AccountMismatch);
        require_keys_eq!(
            self.holder.key(),
            warranty.holder,
            KekalError::AccountMismatch
        );
        let amount = warranty.reserve;
        let seeds: &[&[u8]] = &[SHOP_SEED, shop.owner.as_ref(), &[shop.bump]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.key(),
                TransferChecked {
                    from: self.vault.to_account_info(),
                    mint: self.mint.to_account_info(),
                    to: self.holder_token.to_account_info(),
                    authority: shop.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            self.mint.decimals,
        )?;
        let overflow = || error!(KekalError::Overflow);
        shop.locked_balance = shop
            .locked_balance
            .checked_sub(amount)
            .ok_or_else(overflow)?;
        shop.active_warranties = shop.active_warranties.checked_sub(1).ok_or_else(overflow)?;
        if claim_open {
            shop.open_claims = shop.open_claims.checked_sub(1).ok_or_else(overflow)?;
        }
        shop.paid_count = shop.paid_count.checked_add(1).ok_or_else(overflow)?;
        shop.paid_amount = shop.paid_amount.checked_add(amount).ok_or_else(overflow)?;
        warranty.status = warranty_status::PAID_OUT;
        emit!(ReservePaid {
            shop: shop.key(),
            warranty: warranty.key(),
            holder: warranty.holder,
            amount,
            claim_status
        });
        Ok(())
    }
}

/// Ends the open claim without payment: the warranty is Active again and the cooldown starts.
pub fn close_open_claim(shop: &mut Shop, warranty: &mut Warranty, now: i64) -> Result<()> {
    shop.open_claims = shop
        .open_claims
        .checked_sub(1)
        .ok_or(KekalError::Overflow)?;
    warranty.status = warranty_status::ACTIVE;
    warranty.last_claim_closed_at = now;
    Ok(())
}
