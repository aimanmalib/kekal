mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use kekal::{claim_status, shop_status, warranty_status, Claim, Shop, Warranty};
use solana_signer::Signer;

/// First second at which the fixture shop (last seen at T0) may be declared dormant.
fn silent_at() -> i64 {
    T0 + windows().heartbeat_secs + windows().grace_secs + 1
}

fn declare(env: &mut Env, fx: &Fx) -> Result<(), String> {
    let ix = env.ix_declare_dormant(&fx.shop);
    env.send(&[ix], &[&fx.relayer])
}

fn orphan(env: &mut Env, fx: &Fx, claim: Option<Pubkey>) -> Result<(), String> {
    let anyone = env.funded();
    let ix = env.ix_claim_orphan(&anyone.pubkey(), &fx.warranty, claim);
    env.send(&[ix], &[&anyone])
}

fn release(env: &mut Env, fx: &Fx, warranty: &Pubkey) -> Result<(), String> {
    let ix = env.ix_release(warranty);
    env.send(&[ix], &[&fx.relayer])
}

#[test]
fn declare_dormant_boundary_after_heartbeat_and_grace() {
    let (mut env, fx) = Env::fixture();
    env.set_time(silent_at() - 1);
    assert_err(declare(&mut env, &fx), "ShopStillActive");
    env.set_time(silent_at());
    declare(&mut env, &fx).unwrap();
    let s: Shop = env.load(&fx.shop);
    assert_eq!(
        (s.status, s.dormant_at),
        (shop_status::DORMANT, silent_at())
    );
    assert_err(declare(&mut env, &fx), "ShopDormant");
    // A dormant shop cannot come back by sending a heartbeat.
    let ix = env.ix_heartbeat(&fx.owner.pubkey());
    assert_err(env.send(&[ix], &[&fx.owner]), "ShopDormant");
}

#[test]
fn heartbeat_pushes_the_dormancy_deadline() {
    let (mut env, fx) = Env::fixture();
    env.set_time(silent_at() - 1);
    let ix = env.ix_heartbeat(&fx.owner.pubkey());
    env.send(&[ix], &[&fx.owner]).unwrap();
    env.set_time(silent_at());
    assert_err(declare(&mut env, &fx), "ShopStillActive");
}

#[test]
fn claim_orphan_pays_active_warranty_of_dormant_shop() {
    let (mut env, fx) = Env::fixture();
    env.set_time(silent_at());
    assert_err(orphan(&mut env, &fx, None), "ShopNotDormant");
    declare(&mut env, &fx).unwrap();
    orphan(&mut env, &fx, None).unwrap();
    env.assert_paid(&fx, 0);
    assert_err(orphan(&mut env, &fx, None), "WarrantyNotActive");
    // The shop keeps its free balance and may still withdraw it.
    assert_eq!(env.load::<Shop>(&fx.shop).free_balance, 1_000 - fx.reserve);
}

#[test]
fn claim_orphan_closes_the_open_claim_as_paid_orphan() {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, silent_at() - 5);
    env.set_time(silent_at());
    declare(&mut env, &fx).unwrap();
    // A Claimed warranty must bring its open claim.
    assert_err(orphan(&mut env, &fx, None), "AccountMismatch");
    orphan(&mut env, &fx, Some(claim)).unwrap();
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::PAID_ORPHAN);
    env.assert_paid(&fx, 0);
}

#[test]
fn claim_orphan_refuses_a_closed_claim_on_an_active_warranty() {
    let (mut env, fx) = Env::fixture();
    let claim = env.file_at(&fx, T0 + 10);
    env.respond_at(&fx, &claim, T0 + 20, true).unwrap();
    env.set_time(T0 + 30);
    env.holder_act(&fx, &claim, HolderAction::Confirm).unwrap();
    // The shop's answer at T0 + 20 counts as seen.
    env.set_time(silent_at() + 20);
    declare(&mut env, &fx).unwrap();
    assert_err(orphan(&mut env, &fx, Some(claim)), "AccountMismatch");
    assert_eq!(env.load::<Claim>(&claim).status, claim_status::RESOLVED);
    orphan(&mut env, &fx, None).unwrap();
}

#[test]
fn release_expired_boundary_returns_reserve_to_free() {
    let (mut env, fx) = Env::fixture();
    let expires = env.load::<Warranty>(&fx.warranty).expires_at;
    let vault = env.token_amount(&vault_pda(&fx.shop));
    // Keep the shop alive so only expiry matters.
    env.set_time(expires);
    let ix = env.ix_heartbeat(&fx.owner.pubkey());
    env.send(&[ix], &[&fx.owner]).unwrap();
    assert_err(release(&mut env, &fx, &fx.warranty), "WarrantyNotExpired");
    env.set_time(expires + 1);
    release(&mut env, &fx, &fx.warranty).unwrap();
    assert_eq!(
        env.load::<Warranty>(&fx.warranty).status,
        warranty_status::RELEASED
    );
    let s: Shop = env.load(&fx.shop);
    assert_eq!((s.free_balance, s.locked_balance), (1_000, 0));
    assert_eq!((s.released_amount, s.active_warranties), (fx.reserve, 0));
    assert_eq!(env.token_amount(&vault_pda(&fx.shop)), vault);
    assert_err(release(&mut env, &fx, &fx.warranty), "WarrantyNotActive");
}

#[test]
fn release_refused_while_a_claim_is_open() {
    let (mut env, fx) = Env::fixture();
    env.file_at(&fx, T0 + 10);
    let expires = env.load::<Warranty>(&fx.warranty).expires_at;
    env.set_time(expires + 1);
    assert_err(release(&mut env, &fx, &fx.warranty), "WarrantyNotActive");
}

#[test]
fn dormant_before_expiry_means_holder_not_shop_gets_the_reserve() {
    let (mut env, fx) = Env::fixture();
    env.set_time(silent_at());
    declare(&mut env, &fx).unwrap();
    // Boundary: expiry exactly at the dormant second still belongs to the holder.
    env.poke::<Warranty>(&fx.warranty, |w| w.expires_at = silent_at());
    env.set_time(silent_at() + 1);
    assert_err(release(&mut env, &fx, &fx.warranty), "OwedToHolder");
    orphan(&mut env, &fx, None).unwrap();
    env.assert_paid(&fx, 0);
}

#[test]
fn expired_before_dormant_returns_to_shop_not_holder() {
    let (mut env, fx) = Env::fixture();
    env.set_time(silent_at());
    declare(&mut env, &fx).unwrap();
    env.poke::<Warranty>(&fx.warranty, |w| w.expires_at = silent_at() - 1);
    assert_err(orphan(&mut env, &fx, None), "ExpiredBeforeDormant");
    release(&mut env, &fx, &fx.warranty).unwrap();
    let s: Shop = env.load(&fx.shop);
    assert_eq!((s.free_balance, s.released_amount), (1_000, fx.reserve));
}
