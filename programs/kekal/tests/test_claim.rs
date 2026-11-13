mod common;

use common::*;
use kekal::{claim_status, shop_status, warranty_status, Claim, Shop, Warranty};
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn transfer_holder_moves_the_claim_right() {
    let (mut env, fx) = Env::fixture();
    let new = Keypair::new();
    let ix = env.ix_transfer_holder(&fx.holder.pubkey(), &fx.warranty, new.pubkey());
    env.send(&[ix], &[&fx.relayer, &fx.holder]).unwrap();
    assert_eq!(env.load::<Warranty>(&fx.warranty).holder, new.pubkey());

    // The old key can no longer act.
    let ix = env.ix_transfer_holder(&fx.holder.pubkey(), &fx.warranty, fx.holder.pubkey());
    assert_err(env.send(&[ix], &[&fx.relayer, &fx.holder]), "NotHolder");
    let ix = env.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
    assert_err(env.send(&[ix], &[&fx.relayer, &fx.holder]), "NotHolder");

    // Default key and the same key are refused.
    for bad in [anchor_lang::prelude::Pubkey::default(), new.pubkey()] {
        let ix = env.ix_transfer_holder(&new.pubkey(), &fx.warranty, bad);
        assert_err(env.send(&[ix], &[&fx.relayer, &new]), "InvalidHolder");
    }
}

#[test]
fn transfer_holder_allowed_while_claimed_not_after_payout() {
    let (mut env, fx) = Env::fixture();
    env.file_at(&fx, T0 + 5);
    let next = Keypair::new();
    let ix = env.ix_transfer_holder(&fx.holder.pubkey(), &fx.warranty, next.pubkey());
    env.send(&[ix], &[&fx.relayer, &fx.holder]).unwrap();

    env.poke::<Warranty>(&fx.warranty, |w| w.status = warranty_status::PAID_OUT);
    let ix = env.ix_transfer_holder(&next.pubkey(), &fx.warranty, fx.holder.pubkey());
    assert_err(env.send(&[ix], &[&fx.relayer, &next]), "WarrantyNotActive");
}

#[test]
fn file_claim_records_pending_claim_paid_by_relayer() {
    let (mut env, fx) = Env::fixture();
    assert!(env.svm.get_account(&fx.holder.pubkey()).is_none());
    let claim = env.file_at(&fx, T0 + 10);
    assert_eq!(claim, fx.claim(0));

    let c: Claim = env.load(&claim);
    assert_eq!(
        (c.warranty, c.index, c.status),
        (fx.warranty, 0, claim_status::PENDING)
    );
    assert_eq!((c.filed_at, c.evidence_hash), (T0 + 10, [5; 32]));
    assert_eq!(c.rent_payer, fx.relayer.pubkey());
    let w: Warranty = env.load(&fx.warranty);
    assert_eq!(
        (w.status, w.claim_count, w.open_claim),
        (warranty_status::CLAIMED, 1, 0)
    );
    assert_eq!(env.load::<Shop>(&fx.shop).open_claims, 1);
    // The holder still holds no SOL.
    assert!(env.svm.get_account(&fx.holder.pubkey()).is_none());

    // Only one open claim at a time.
    let ix = env.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
    assert_err(
        env.send(&[ix], &[&fx.relayer, &fx.holder]),
        "WarrantyNotActive",
    );
}

#[test]
fn file_claim_expiry_boundary() {
    let (mut env, fx) = Env::fixture();
    let expires = env.load::<Warranty>(&fx.warranty).expires_at;
    env.set_time(expires + 1);
    let ix = env.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
    assert_err(
        env.send(&[ix], &[&fx.relayer, &fx.holder]),
        "WarrantyExpired",
    );
    env.file_at(&fx, expires);
}

#[test]
fn file_claim_refused_for_dormant_shop_and_stranger() {
    let (mut env, fx) = Env::fixture();
    let stranger = Keypair::new();
    let mut ix = env.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
    ix.accounts[1].pubkey = stranger.pubkey();
    assert_err(env.send(&[ix], &[&fx.relayer, &stranger]), "NotHolder");

    env.poke::<Shop>(&fx.shop, |s| s.status = shop_status::DORMANT);
    let ix = env.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
    assert_err(env.send(&[ix], &[&fx.relayer, &fx.holder]), "ShopDormant");
}

#[test]
fn file_claim_cooldown_and_maximum() {
    let (mut env, fx) = Env::fixture();
    let c0 = env.file_at(&fx, T0 + 1);
    env.respond_at(&fx, &c0, T0 + 2, true).unwrap();
    env.set_time(T0 + 3);
    env.holder_act(&fx, &c0, HolderAction::Confirm).unwrap();
    let cooldown = limits().claim_cooldown_secs;

    env.set_time(T0 + 3 + cooldown - 1);
    let ix = env.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
    assert_err(env.send(&[ix], &[&fx.relayer, &fx.holder]), "ClaimCooldown");
    let c1 = env.file_at(&fx, T0 + 3 + cooldown);
    assert_eq!(c1, fx.claim(1));

    // At the maximum claim count no further claim opens.
    env.poke::<Warranty>(&fx.warranty, |w| {
        w.status = warranty_status::ACTIVE;
        w.claim_count = u16::from(limits().max_claims_per_warranty);
        w.last_claim_closed_at = 0;
    });
    let ix = env.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
    assert_err(env.send(&[ix], &[&fx.relayer, &fx.holder]), "TooManyClaims");
}

#[test]
fn respond_boundary_at_response_window() {
    // Appendix A vector with R = 60: answer at t0 + 60 passes, at t0 + 61 fails.
    let r = windows().response_secs;
    let (mut env, fx) = Env::fixture();
    let t0 = T0 + 100;
    let claim = env.file_at(&fx, t0);
    assert_err(
        env.respond_at(&fx, &claim, t0 + r + 1, true),
        "ResponseWindowClosed",
    );
    env.respond_at(&fx, &claim, t0 + r, true).unwrap();
    let c: Claim = env.load(&claim);
    assert_eq!(c.status, claim_status::ACCEPTED);
    assert_eq!(
        (c.responded_at, c.repair_deadline),
        (t0 + r, t0 + r + windows().repair_secs)
    );
    assert_eq!(c.response_hash, [6; 32]);
    assert_eq!(env.load::<Shop>(&fx.shop).last_seen, t0 + r);
    // A claim is answered once.
    assert_err(
        env.respond_at(&fx, &claim, t0 + r, false),
        "InvalidClaimState",
    );
}

#[test]
fn respond_reject_sets_dispute_deadline() {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);
    env.respond_at(&fx, &claim, T0 + 20, false).unwrap();
    let c: Claim = env.load(&claim);
    assert_eq!(c.status, claim_status::REJECTED);
    assert_eq!(c.dispute_deadline, T0 + 20 + windows().dispute_secs);
    assert_eq!(c.repair_deadline, 0);
}

#[test]
fn respond_refused_for_other_shop_dormant_shop_and_wrong_warranty() {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);

    // Another shop's owner cannot answer through their own shop.
    let (other, _) = env.shop_with(500);
    let ix = env.ix_respond(&other.pubkey(), &fx.warranty, &claim, true);
    assert!(env.send(&[ix], &[&other]).is_err());

    // A claim paired with a warranty it does not belong to is refused.
    let h2 = Keypair::new().pubkey();
    env.send(
        &[env.ix_issue(&fx.owner.pubkey(), env.issue_params(&h2, 10))],
        &[&fx.owner],
    )
    .unwrap();
    let w1 = warranty_pda(&fx.shop, 1);
    let ix = env.ix_respond(&fx.owner.pubkey(), &w1, &claim, true);
    assert!(env.send(&[ix], &[&fx.owner]).is_err());

    env.poke::<Shop>(&fx.shop, |s| s.status = shop_status::DORMANT);
    assert_err(env.respond_at(&fx, &claim, T0 + 11, true), "ShopDormant");
}
