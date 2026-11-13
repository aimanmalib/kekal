mod common;

use common::*;
use kekal::Shop;
use solana_signer::Signer;

#[test]
fn deposit_moves_tokens_into_vault() {
    let mut env = Env::new();
    let (owner, ata) = env.shop_with(0);
    env.set_time(T0 + 30);
    env.send(&[env.ix_deposit(&owner.pubkey(), &ata, 250)], &[&owner])
        .unwrap();
    let shop: Shop = env.load(&shop_pda(&owner.pubkey()));
    assert_eq!(shop.free_balance, 250);
    assert_eq!(shop.last_seen, T0 + 30);
    assert_eq!(env.token_amount(&shop.vault), 250);
    assert_eq!(env.token_amount(&ata), 1_000_000_000 - 250);
}

#[test]
fn deposit_and_withdraw_reject_zero() {
    let mut env = Env::new();
    let (owner, ata) = env.shop_with(100);
    assert_err(
        env.send(&[env.ix_deposit(&owner.pubkey(), &ata, 0)], &[&owner]),
        "ZeroAmount",
    );
    assert_err(
        env.send(&[env.ix_withdraw(&owner.pubkey(), &ata, 0)], &[&owner]),
        "ZeroAmount",
    );
}

#[test]
fn withdraw_up_to_free_balance_only() {
    let mut env = Env::new();
    let (owner, ata) = env.shop_with(500);
    let holder = env.funded();
    env.send(
        &[env.ix_issue(&owner.pubkey(), env.issue_params(&holder.pubkey(), 300))],
        &[&owner],
    )
    .unwrap();
    // free = 200, locked = 300: one unit over free fails, exactly free passes.
    let over = env.ix_withdraw(&owner.pubkey(), &ata, 201);
    assert_err(env.send(&[over], &[&owner]), "InsufficientFreeBalance");
    env.send(&[env.ix_withdraw(&owner.pubkey(), &ata, 200)], &[&owner])
        .unwrap();
    let shop: Shop = env.load(&shop_pda(&owner.pubkey()));
    assert_eq!((shop.free_balance, shop.locked_balance), (0, 300));
    assert_eq!(env.token_amount(&shop.vault), 300);
}

#[test]
fn withdraw_allowed_while_dormant() {
    let mut env = Env::new();
    let (owner, ata) = env.shop_with(100);
    env.poke::<Shop>(&shop_pda(&owner.pubkey()), |s| {
        s.status = kekal::shop_status::DORMANT
    });
    env.send(&[env.ix_withdraw(&owner.pubkey(), &ata, 100)], &[&owner])
        .unwrap();
}

#[test]
fn withdraw_rejects_stranger_and_foreign_accounts() {
    let mut env = Env::new();
    let (owner, ata) = env.shop_with(100);
    let (other, other_ata) = env.shop_with(100);

    // Stranger signs with the owner's shop: seeds and has_one fail.
    let stranger = env.funded();
    let mut metas = env.move_metas(&owner.pubkey(), &ata);
    metas.owner = stranger.pubkey();
    let ix = withdraw_ix(metas, 10);
    assert!(env.send(&[ix], &[&stranger]).is_err());

    // Another shop's vault.
    let mut metas = env.move_metas(&owner.pubkey(), &ata);
    metas.vault = vault_pda(&shop_pda(&other.pubkey()));
    assert_err(
        env.send(&[withdraw_ix(metas, 10)], &[&owner]),
        "ConstraintHasOne",
    );

    // Destination token account owned by someone else.
    let metas = env.move_metas(&owner.pubkey(), &other_ata);
    assert_err(
        env.send(&[withdraw_ix(metas, 10)], &[&owner]),
        "ConstraintTokenOwner",
    );

    // Token account of a different mint.
    let fake_mint = anchor_lang::prelude::Pubkey::new_unique();
    env.put_mint(&fake_mint);
    let fake = env.put_token(&fake_mint, &owner.pubkey(), 100);
    let mut metas = env.move_metas(&owner.pubkey(), &fake);
    metas.mint = fake_mint;
    assert_err(
        env.send(&[withdraw_ix(metas, 10)], &[&owner]),
        "ConstraintHasOne",
    );
}

fn withdraw_ix(
    metas: kekal::accounts::MoveFunds,
    amount: u64,
) -> anchor_lang::solana_program::instruction::Instruction {
    use anchor_lang::{InstructionData, ToAccountMetas};
    anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        kekal::id(),
        &kekal::instruction::Withdraw { amount }.data(),
        metas.to_account_metas(None),
    )
}
