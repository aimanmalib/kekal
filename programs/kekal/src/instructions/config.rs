use anchor_lang::prelude::*;

use crate::constants::{ALLOWED_MINT_SLOTS, CONFIG_SEED};
use crate::events::{ConfigInitialized, ConfigUpdated};
use crate::state::{Config, ConfigLimits};

/// Everything the admin controls in `Config`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct ConfigParams {
    pub default_arbiter: Pubkey,
    pub assessor: Pubkey,
    pub limits: ConfigLimits,
    pub allowed_mints: [Pubkey; ALLOWED_MINT_SLOTS],
    pub paused: bool,
}

fn apply(config: &mut Config, params: &ConfigParams) -> Result<()> {
    params.limits.validate()?;
    config.default_arbiter = params.default_arbiter;
    config.assessor = params.assessor;
    config.limits = params.limits;
    config.allowed_mints = params.allowed_mints;
    config.paused = params.paused;
    Ok(())
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_config(ctx: Context<InitConfig>, params: ConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.bump = ctx.bumps.config;
    apply(config, &params)?;
    emit!(ConfigInitialized {
        admin: config.admin
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

pub fn handle_set_config(ctx: Context<SetConfig>, params: ConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    apply(config, &params)?;
    emit!(ConfigUpdated {
        admin: config.admin,
        paused: config.paused
    });
    Ok(())
}
