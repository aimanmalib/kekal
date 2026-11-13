mod common;

use common::*;
use kekal::{claim_status, warranty_status, Claim, Shop, Warranty};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Claim filed at T0 + 10 and answered at T0 + 20.
fn answered(accept: bool) -> (Env, Fx, anchor_lang::prelude::Pubkey) {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);
    env.respond_at(&fx, &claim, T0 + 20, accept).unwrap();
    (env, fx, claim)
}

fn disputed() -> (Env, Fx, anchor_lang::prelude::Pubkey) {
    let (mut env, fx, claim) = answered(false);
    env.set_time(T0 + 30);
    env.holder_act(&fx, &claim, HolderAction::Escalate).unwrap();
    (env, fx, claim)
}

#[test]
fn confirm_resolved_returns_warranty_to_active() {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);
    assert_err(
        env.holder_act(&fx, &claim, HolderAction::Confirm),
        "InvalidClaimState",
    );
    env.respond_at(&fx, &claim, T0 + 20, true).unwrap();

    let stranger = Keypair::new();
    let ix = env.ix_holder_claim(
        HolderAction::Confirm,
        &stranger.pubkey(),
        &fx.shop,
        &fx.warranty,
        &claim,
    );
    assert_err(env.send(&[ix], &[&fx.relayer, &stranger]), "NotHolder");

    env.set_time(T0 + 25);
    env.holder_act(&fx, &claim, HolderAction::Confirm).unwrap();
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::RESOLVED);
    let w: Warranty = env.load(&fx.warranty);
    assert_eq!(
        (w.status, w.last_claim_closed_at),
        (warranty_status::ACTIVE, T0 + 25)
    );
    let shop: Shop = env.load(&fx.shop);
    assert_eq!((shop.open_claims, shop.locked_balance), (0, fx.reserve));
}

#[test]
fn escalate_rejected_boundary_at_dispute_deadline() {
    let d = windows().dispute_secs;
    let (mut env, fx, claim) = answered(false);
    env.set_time(T0 + 20 + d + 1);
    assert_err(
        env.holder_act(&fx, &claim, HolderAction::Escalate),
        "EscalationNotAllowed",
    );
    env.set_time(T0 + 20 + d);
    env.holder_act(&fx, &claim, HolderAction::Escalate).unwrap();
    let c: Claim = env.load(&claim);
    assert_eq!(
        (c.status, c.escalated_at),
        (claim_status::DISPUTED, T0 + 20 + d)
    );
}

#[test]
fn escalate_accepted_only_after_repair_deadline_and_before_close() {
    let (p, d) = (windows().repair_secs, windows().dispute_secs);
    let t1 = T0 + 20;
    for (t, ok) in [
        (t1 + p, false),
        (t1 + p + 1, true),
        (t1 + p + d, true),
        (t1 + p + d + 1, false),
    ] {
        let (mut env, fx, claim) = answered(true);
        env.set_time(t);
        let res = env.holder_act(&fx, &claim, HolderAction::Escalate);
        if ok {
            res.unwrap();
            assert_eq!(env.load::<Claim>(&claim).status, claim_status::DISPUTED);
        } else {
            assert_err(res, "EscalationNotAllowed");
        }
    }
}

#[test]
fn escalate_refused_for_pending_and_disputed_claims() {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);
    assert_err(
        env.holder_act(&fx, &claim, HolderAction::Escalate),
        "InvalidClaimState",
    );
    let (mut env, fx, claim) = disputed();
    assert_err(
        env.holder_act(&fx, &claim, HolderAction::Escalate),
        "InvalidClaimState",
    );
}

#[test]
fn resolve_for_buyer_pays_full_reserve_to_holder() {
    let (mut env, fx, claim) = disputed();
    let arbiter = env.arbiter.insecure_clone();
    let vault = vault_pda(&fx.shop);
    let before = env.token_amount(&vault);
    let ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &arbiter.pubkey(),
        &fx.warranty,
        &claim,
        true,
    );
    env.send(&[ix], &[&fx.relayer, &arbiter]).unwrap();

    assert_eq!(
        env.token_amount(&ata(&fx.holder.pubkey(), &env.mint)),
        fx.reserve
    );
    assert_eq!(env.token_amount(&vault), before - fx.reserve);
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::PAID_ARBITER);
    assert_eq!(
        env.load::<Warranty>(&fx.warranty).status,
        warranty_status::PAID_OUT
    );
    let s: Shop = env.load(&fx.shop);
    assert_eq!((s.locked_balance, s.free_balance), (0, 1_000 - fx.reserve));
    assert_eq!((s.open_claims, s.active_warranties), (0, 0));
    assert_eq!((s.paid_count, s.paid_amount), (1, fx.reserve));
    // I1 and no second payment.
    assert!(env.token_amount(&vault) >= s.free_balance + s.locked_balance);
    let ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &arbiter.pubkey(),
        &fx.warranty,
        &claim,
        true,
    );
    assert_err(
        env.send(&[ix], &[&fx.relayer, &arbiter]),
        "InvalidClaimState",
    );
}

#[test]
fn resolve_for_shop_dismisses_and_allows_a_new_claim() {
    let (mut env, fx, claim) = disputed();
    let arbiter = env.arbiter.insecure_clone();
    env.set_time(T0 + 40);
    let ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &arbiter.pubkey(),
        &fx.warranty,
        &claim,
        false,
    );
    env.send(&[ix], &[&fx.relayer, &arbiter]).unwrap();
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::DISMISSED);
    let w: Warranty = env.load(&fx.warranty);
    assert_eq!(
        (w.status, w.last_claim_closed_at),
        (warranty_status::ACTIVE, T0 + 40)
    );
    let s: Shop = env.load(&fx.shop);
    assert_eq!(
        (s.locked_balance, s.open_claims, s.paid_count),
        (fx.reserve, 0, 0)
    );
    let next = env.file_at(&fx, T0 + 40 + limits().claim_cooldown_secs);
    assert_eq!(next, fx.claim(1));
}

#[test]
fn resolve_refused_for_non_arbiter_and_undisputed_claim() {
    let (mut env, fx, claim) = answered(false);
    let arbiter = env.arbiter.insecure_clone();
    let ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &arbiter.pubkey(),
        &fx.warranty,
        &claim,
        true,
    );
    assert_err(
        env.send(&[ix], &[&fx.relayer, &arbiter]),
        "InvalidClaimState",
    );

    let (mut env, fx, claim) = disputed();
    // The shop owner is not the arbiter.
    let ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &fx.owner.pubkey(),
        &fx.warranty,
        &claim,
        true,
    );
    assert_err(env.send(&[ix], &[&fx.relayer, &fx.owner]), "NotArbiter");
}

#[test]
fn resolve_refuses_payout_to_a_key_other_than_holder() {
    let (mut env, fx, claim) = disputed();
    let arbiter = env.arbiter.insecure_clone();
    let thief = Keypair::new().pubkey();
    let mut ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &arbiter.pubkey(),
        &fx.warranty,
        &claim,
        true,
    );
    // Payout accounts start after arbiter, shop, warranty, claim: payer, mint, vault, holder, holder_token.
    ix.accounts[7].pubkey = thief;
    ix.accounts[8].pubkey = ata(&thief, &env.mint);
    assert_err(env.send(&[ix], &[&fx.relayer, &arbiter]), "AccountMismatch");

    // A vault that is not the shop's is refused too.
    let fake_vault = env.put_token(&env.mint.clone(), &fx.shop, 10_000);
    let mut ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &arbiter.pubkey(),
        &fx.warranty,
        &claim,
        true,
    );
    ix.accounts[6].pubkey = fake_vault;
    assert_err(env.send(&[ix], &[&fx.relayer, &arbiter]), "AccountMismatch");
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::DISPUTED);
}
