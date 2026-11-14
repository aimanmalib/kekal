mod common;

use common::*;
use kekal::{claim_status, warranty_status, Claim, Shop, Warranty};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Claim filed at T0 + 10, answered at T0 + 20 when `answer` is set.
fn claim(answer: Option<bool>) -> (Env, Fx, anchor_lang::prelude::Pubkey) {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);
    if let Some(accept) = answer {
        env.respond_at(&fx, &claim, T0 + 20, accept).unwrap();
    }
    (env, fx, claim)
}

fn settle(
    env: &mut Env,
    kind: Settle,
    fx: &Fx,
    claim: &anchor_lang::prelude::Pubkey,
) -> Result<(), String> {
    // Any key may send it; this one has no tie to the shop or the holder.
    let anyone = env.funded();
    let ix = env.ix_settle(kind, &anyone.pubkey(), &fx.warranty, claim);
    env.send(&[ix], &[&anyone])
}

#[test]
fn settle_unanswered_boundary_pays_holder_once() {
    let r = windows().response_secs;
    let (mut env, fx, claim) = claim(None);
    env.set_time(T0 + 10 + r);
    assert_err(
        settle(&mut env, Settle::Unanswered, &fx, &claim),
        "WindowStillOpen",
    );
    env.set_time(T0 + 10 + r + 1);
    settle(&mut env, Settle::Unanswered, &fx, &claim).unwrap();
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::PAID_TIMEOUT);
    env.assert_paid(&fx, 0);
    // No second payment, and the shop can no longer answer.
    assert_err(
        settle(&mut env, Settle::Unanswered, &fx, &claim),
        "InvalidClaimState",
    );
    assert_err(
        env.respond_at(&fx, &claim, T0 + 10 + r + 2, true),
        "InvalidClaimState",
    );
}

#[test]
fn settle_unanswered_refused_once_the_shop_answered() {
    for accept in [true, false] {
        let (mut env, fx, claim) = claim(Some(accept));
        env.set_time(T0 + 10 + windows().response_secs + 1);
        assert_err(
            settle(&mut env, Settle::Unanswered, &fx, &claim),
            "InvalidClaimState",
        );
    }
}

#[test]
fn settle_unanswered_pays_the_current_holder_only() {
    let (mut env, fx, claim) = claim(None);
    let next = Keypair::new();
    let ix = env.ix_transfer_holder(&fx.holder.pubkey(), &fx.warranty, next.pubkey());
    env.send(&[ix], &[&fx.relayer, &fx.holder]).unwrap();
    env.set_time(T0 + 10 + windows().response_secs + 1);

    let mut ix = env.ix_settle(
        Settle::Unanswered,
        &fx.relayer.pubkey(),
        &fx.warranty,
        &claim,
    );
    // Payout accounts start after config, shop, warranty, claim: payer, mint, vault, holder, holder_token.
    ix.accounts[7].pubkey = fx.holder.pubkey();
    ix.accounts[8].pubkey = ata(&fx.holder.pubkey(), &env.mint);
    assert_err(env.send(&[ix], &[&fx.relayer]), "AccountMismatch");

    settle(&mut env, Settle::Unanswered, &fx, &claim).unwrap();
    assert_eq!(
        env.token_amount(&ata(&next.pubkey(), &env.mint)),
        fx.reserve
    );
    assert!(env
        .svm
        .get_account(&ata(&fx.holder.pubkey(), &env.mint))
        .is_none());
}

#[test]
fn close_stale_rejected_after_dispute_deadline() {
    let d = windows().dispute_secs;
    let (mut env, fx, claim) = claim(Some(false));
    env.set_time(T0 + 20 + d);
    assert_err(
        env.send(&[env.ix_close_stale(&fx.warranty, &claim)], &[&fx.relayer]),
        "WindowStillOpen",
    );
    env.set_time(T0 + 20 + d + 1);
    env.send(&[env.ix_close_stale(&fx.warranty, &claim)], &[&fx.relayer])
        .unwrap();
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::CLOSED);
    let w: Warranty = env.load(&fx.warranty);
    assert_eq!(
        (w.status, w.last_claim_closed_at),
        (warranty_status::ACTIVE, T0 + 20 + d + 1)
    );
    let s: Shop = env.load(&fx.shop);
    assert_eq!(
        (s.open_claims, s.locked_balance, s.paid_count),
        (0, fx.reserve, 0)
    );
    // Escalation is over for this claim.
    assert_err(
        env.holder_act(&fx, &claim, HolderAction::Escalate),
        "InvalidClaimState",
    );
}

#[test]
fn close_stale_accepted_after_repair_plus_dispute_window() {
    let (p, d) = (windows().repair_secs, windows().dispute_secs);
    let (mut env, fx, claim) = claim(Some(true));
    env.set_time(T0 + 20 + p + d);
    assert_err(
        env.send(&[env.ix_close_stale(&fx.warranty, &claim)], &[&fx.relayer]),
        "WindowStillOpen",
    );
    env.set_time(T0 + 20 + p + d + 1);
    env.send(&[env.ix_close_stale(&fx.warranty, &claim)], &[&fx.relayer])
        .unwrap();
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::RESOLVED);
    assert_eq!(
        env.load::<Warranty>(&fx.warranty).status,
        warranty_status::ACTIVE
    );
    assert_eq!(env.load::<Shop>(&fx.shop).open_claims, 0);
}

#[test]
fn close_stale_refused_for_pending_and_disputed_claims() {
    let (mut env, fx, claim) = claim(None);
    env.set_time(T0 + DAY);
    assert_err(
        env.send(&[env.ix_close_stale(&fx.warranty, &claim)], &[&fx.relayer]),
        "InvalidClaimState",
    );

    let (mut env, fx, claim) = self::claim(Some(false));
    env.set_time(T0 + 30);
    env.holder_act(&fx, &claim, HolderAction::Escalate).unwrap();
    env.set_time(T0 + DAY);
    assert_err(
        env.send(&[env.ix_close_stale(&fx.warranty, &claim)], &[&fx.relayer]),
        "InvalidClaimState",
    );
}

#[test]
fn settle_stale_dispute_boundary_pays_holder() {
    let timeout = limits().dispute_timeout_secs;
    let (mut env, fx, claim) = claim(Some(false));
    env.set_time(T0 + 30);
    // Not disputed yet.
    assert_err(
        settle(&mut env, Settle::StaleDispute, &fx, &claim),
        "InvalidClaimState",
    );
    env.holder_act(&fx, &claim, HolderAction::Escalate).unwrap();
    env.set_time(T0 + 30 + timeout);
    assert_err(
        settle(&mut env, Settle::StaleDispute, &fx, &claim),
        "WindowStillOpen",
    );
    env.set_time(T0 + 30 + timeout + 1);
    settle(&mut env, Settle::StaleDispute, &fx, &claim).unwrap();
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::PAID_STALE);
    env.assert_paid(&fx, 0);

    // The arbiter can no longer decide, and nothing pays twice.
    let arbiter = env.arbiter.insecure_clone();
    let ix = env.ix_resolve(
        &fx.relayer.pubkey(),
        &arbiter.pubkey(),
        &fx.warranty,
        &claim,
        false,
    );
    assert_err(
        env.send(&[ix], &[&fx.relayer, &arbiter]),
        "InvalidClaimState",
    );
    assert_err(
        settle(&mut env, Settle::StaleDispute, &fx, &claim),
        "InvalidClaimState",
    );
}
