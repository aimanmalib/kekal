//! Attacks on the program: wrong signers, substituted accounts, double payment, overflow and a
//! former holder. Each failed attack must leave the books unchanged.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use common::*;
use kekal::{shop_status, warranty_status, Shop, Warranty};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Fixture with a Pending claim filed at T0 + 10 and the response window over (T0 + 71).
fn unanswered() -> (Env, Fx, Pubkey) {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);
    env.set_time(T0 + 71);
    (env, fx, claim)
}

fn swap(ix: &mut Instruction, from: &Pubkey, to: Pubkey) {
    let meta = ix.accounts.iter_mut().find(|m| m.pubkey == *from).unwrap();
    meta.pubkey = to;
}

fn books(env: &Env, shop: &Pubkey) -> (u64, u64, u64, u8) {
    let s: Shop = env.load(shop);
    (s.free_balance, s.locked_balance, s.paid_amount, s.status)
}

/// Sends `ix` signed and paid by a fresh key and asserts it fails without touching the books.
fn refused(env: &mut Env, fx: &Fx, mut ix: Instruction, error: Option<&str>) {
    let before = books(env, &fx.shop);
    let payer = env.funded();
    for meta in ix.accounts.iter_mut().filter(|m| m.is_signer) {
        meta.pubkey = payer.pubkey();
    }
    let res = env.send(&[ix], &[&payer]);
    match error {
        Some(name) => assert_err(res, name),
        None => assert!(res.is_err(), "attack succeeded"),
    }
    assert_eq!(
        before,
        books(env, &fx.shop),
        "failed attack changed the books"
    );
}

fn settle_ix(env: &Env, fx: &Fx, claim: &Pubkey) -> Instruction {
    env.ix_settle(
        Settle::Unanswered,
        &fx.relayer.pubkey(),
        &fx.warranty,
        claim,
    )
}

/// Sends a payout instruction whose payer is the fixture relayer.
fn relayed(env: &mut Env, fx: &Fx, ix: Instruction) -> Result<(), String> {
    env.send(&[ix], &[&fx.relayer])
}

#[test]
fn payout_refuses_another_shops_vault_or_a_foreign_token_account() {
    let (mut env, fx, claim) = unanswered();
    let (other, _) = env.shop_with(5_000);
    let other_vault = vault_pda(&shop_pda(&other.pubkey()));
    let mint = env.mint;
    let foreign = env.put_token(&mint, &Keypair::new().pubkey(), 5_000);
    for fake in [other_vault, foreign] {
        let mut ix = settle_ix(&env, &fx, &claim);
        swap(&mut ix, &vault_pda(&fx.shop), fake);
        let before = (books(&env, &fx.shop), env.token_amount(&fake));
        assert_err(relayed(&mut env, &fx, ix), "AccountMismatch");
        assert_eq!(before, (books(&env, &fx.shop), env.token_amount(&fake)));
    }
    let ix = settle_ix(&env, &fx, &claim);
    relayed(&mut env, &fx, ix).unwrap();
    env.assert_paid(&fx, 0);
}

#[test]
fn payout_refuses_a_fake_mint_and_a_non_ata_destination() {
    let (mut env, fx, claim) = unanswered();
    let fake_mint = Pubkey::new_unique();
    env.put_mint(&fake_mint);
    let mut ix = settle_ix(&env, &fx, &claim);
    let mint = env.mint;
    swap(&mut ix, &mint, fake_mint);
    refused(&mut env, &fx, ix, None);

    // Same mint, owned by the holder, but not the holder's associated token account.
    let side = env.put_token(&mint, &fx.holder.pubkey(), 0);
    let mut ix = settle_ix(&env, &fx, &claim);
    swap(&mut ix, &ata(&fx.holder.pubkey(), &mint), side);
    assert!(relayed(&mut env, &fx, ix).is_err());
    assert_eq!(env.token_amount(&side), 0);
}

#[test]
fn instructions_refuse_a_warranty_paired_with_another_shop() {
    let (mut env, fx, claim) = unanswered();
    let (other, other_token) = env.shop_with(5_000);
    let other_shop = shop_pda(&other.pubkey());
    let mut ix = settle_ix(&env, &fx, &claim);
    swap(&mut ix, &fx.shop, other_shop);
    refused(&mut env, &fx, ix, None);

    env.set_time(T0 + 4_000);
    let mut ix = env.ix_release(&fx.warranty);
    swap(&mut ix, &fx.shop, other_shop);
    refused(&mut env, &fx, ix, None);

    // The other owner signs a withdrawal naming the fixture shop and vault.
    let mut ix = env.ix_withdraw(&other.pubkey(), &other_token, 1);
    swap(&mut ix, &other_shop, fx.shop);
    swap(&mut ix, &vault_pda(&other_shop), vault_pda(&fx.shop));
    let before = books(&env, &fx.shop);
    assert!(env.send(&[ix], &[&other]).is_err());
    assert_eq!(before, books(&env, &fx.shop));
}

#[test]
fn a_reserve_is_paid_once_whatever_route_is_tried_next() {
    let (mut env, fx, claim) = unanswered();
    let ix = settle_ix(&env, &fx, &claim);
    relayed(&mut env, &fx, ix).unwrap();
    env.set_time(T0 + 2_000);
    let payer = fx.relayer.pubkey();
    for ix in [
        settle_ix(&env, &fx, &claim),
        env.ix_settle(Settle::StaleDispute, &payer, &fx.warranty, &claim),
    ] {
        assert!(relayed(&mut env, &fx, ix).is_err());
    }
    let arbiter = env.arbiter.insecure_clone();
    let ix = env.ix_resolve(&payer, &arbiter.pubkey(), &fx.warranty, &claim, true);
    assert!(env.send(&[ix], &[&fx.relayer, &arbiter]).is_err());
    let ix = env.ix_declare_dormant(&fx.shop);
    env.send(&[ix], &[&fx.relayer]).unwrap();
    let ix = env.ix_claim_orphan(&payer, &fx.warranty, None);
    assert_err(relayed(&mut env, &fx, ix), "WarrantyNotActive");
    env.set_time(T0 + 4_000);
    let ix = env.ix_release(&fx.warranty);
    refused(&mut env, &fx, ix, Some("WarrantyNotActive"));
    env.assert_paid(&fx, 0);
}

#[test]
fn holder_and_arbiter_must_sign() {
    let (mut env, fx) = Env::fixture();
    let mut ix = env.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
    ix.accounts[1].is_signer = false;
    assert!(relayed(&mut env, &fx, ix).is_err());
    assert_eq!(env.load::<Warranty>(&fx.warranty).claim_count, 0);

    let claim = env.file_at(&fx, T0 + 10);
    env.respond_at(&fx, &claim, T0 + 20, false).unwrap();
    env.set_time(T0 + 30);
    env.holder_act(&fx, &claim, HolderAction::Escalate).unwrap();
    let mut ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &env.arbiter.pubkey(),
        &fx.warranty,
        &claim,
        true,
    );
    ix.accounts[0].is_signer = false;
    let before = books(&env, &fx.shop);
    assert!(relayed(&mut env, &fx, ix).is_err());
    assert_eq!(before, books(&env, &fx.shop));
}

#[test]
fn a_former_holder_loses_every_claim_right() {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);
    env.respond_at(&fx, &claim, T0 + 20, false).unwrap();
    let new = Keypair::new();
    let ix = env.ix_transfer_holder(&fx.holder.pubkey(), &fx.warranty, new.pubkey());
    env.send(&[ix], &[&fx.relayer, &fx.holder]).unwrap();
    env.set_time(T0 + 30);
    for act in [HolderAction::Escalate, HolderAction::Confirm] {
        assert_err(env.holder_act(&fx, &claim, act), "NotHolder");
    }
    let ix = env.ix_transfer_holder(&fx.holder.pubkey(), &fx.warranty, fx.holder.pubkey());
    assert_err(env.send(&[ix], &[&fx.relayer, &fx.holder]), "NotHolder");
    let w: Warranty = env.load(&fx.warranty);
    assert_eq!(
        (w.holder, w.status),
        (new.pubkey(), warranty_status::CLAIMED)
    );
}

#[test]
fn extreme_windows_and_amounts_fail_closed_instead_of_wrapping() {
    let mut env = Env::new();
    let mut params = env.params();
    params.limits.max_heartbeat_secs = i64::MAX;
    params.limits.max_grace_secs = i64::MAX;
    let admin = env.admin.insecure_clone();
    let ix = env.ix_set_config(&admin.pubkey(), params);
    env.send(&[ix], &[&admin]).unwrap();
    let owner = env.funded();
    let mint = env.mint;
    let token = env.put_token(&mint, &owner.pubkey(), 1_000);
    let mut w = windows();
    w.heartbeat_secs = i64::MAX;
    w.grace_secs = i64::MAX;
    let ix = env.ix_create_shop(&owner.pubkey(), &mint, w, None);
    env.send(&[ix], &[&owner]).unwrap();
    let shop = shop_pda(&owner.pubkey());
    env.set_time(T0 + 1);
    let stranger = env.funded();
    let ix = env.ix_declare_dormant(&shop);
    assert_err(env.send(&[ix], &[&stranger]), "Overflow");
    assert_eq!(env.load::<Shop>(&shop).status, shop_status::ACTIVE);

    let ix = env.ix_deposit(&owner.pubkey(), &token, 1_000);
    env.send(&[ix], &[&owner]).unwrap();
    let params = env.issue_params(&Keypair::new().pubkey(), u64::MAX);
    let ix = env.ix_issue(&owner.pubkey(), params);
    assert!(env.send(&[ix], &[&owner]).is_err());
    let s: Shop = env.load(&shop);
    assert_eq!((s.free_balance, s.locked_balance, s.issued), (1_000, 0, 0));
}

#[test]
fn deposit_from_a_token_account_of_another_mint_is_refused() {
    let (mut env, fx) = Env::fixture();
    let other_mint = Pubkey::new_unique();
    env.put_mint(&other_mint);
    let token = env.put_token(&other_mint, &fx.owner.pubkey(), 1_000);
    let ix = env.ix_deposit(&fx.owner.pubkey(), &token, 500);
    let before = books(&env, &fx.shop);
    assert!(env.send(&[ix], &[&fx.owner]).is_err());
    assert_eq!(before, books(&env, &fx.shop));
    assert_eq!(env.token_amount(&token), 1_000);
}
