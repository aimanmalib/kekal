mod common;

use anchor_lang::prelude::Pubkey;
use anchor_spl::token::spl_token;
use common::*;
use kekal::{shop_status, Shop, ShopWindows};
use solana_signer::Signer;

#[test]
fn create_shop_sets_fields_and_vault() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(0);
    let shop_key = shop_pda(&owner.pubkey());
    let shop: Shop = env.load(&shop_key);
    assert_eq!(shop.owner, owner.pubkey());
    assert_eq!(shop.mint, env.mint);
    assert_eq!(shop.vault, vault_pda(&shop_key));
    assert_eq!(shop.arbiter, env.arbiter.pubkey());
    assert_eq!(shop.response_secs, windows().response_secs);
    assert_eq!(shop.grace_secs, windows().grace_secs);
    assert_eq!((shop.last_seen, shop.created_at), (T0, T0));
    assert_eq!(shop.status, shop_status::ACTIVE);
    assert_eq!(
        (
            shop.free_balance,
            shop.locked_balance,
            shop.next_warranty_id
        ),
        (0, 0, 0)
    );
    assert_eq!(shop.profile_hash, [1; 32]);

    let vault = env.svm.get_account(&shop.vault).unwrap();
    assert_eq!(vault.owner, spl_token::ID);
    use anchor_lang::solana_program::program_pack::Pack;
    let v = spl_token::state::Account::unpack(&vault.data).unwrap();
    assert_eq!((v.mint, v.owner, v.amount), (env.mint, shop_key, 0));
}

#[test]
fn create_shop_explicit_arbiter_and_one_per_owner() {
    let mut env = Env::new();
    let owner = env.funded();
    let arbiter = Pubkey::new_unique();
    let mint = env.mint;
    env.send(
        &[env.ix_create_shop(&owner.pubkey(), &mint, windows(), Some(arbiter))],
        &[&owner],
    )
    .unwrap();
    let shop: Shop = env.load(&shop_pda(&owner.pubkey()));
    assert_eq!(shop.arbiter, arbiter);
    let again = env.ix_create_shop(&owner.pubkey(), &mint, windows(), None);
    assert_err(env.send(&[again], &[&owner]), "already in use");
}

#[test]
fn create_shop_rejects_mint_not_allowed() {
    let mut env = Env::new();
    let owner = env.funded();
    let other_mint = Pubkey::new_unique();
    env.put_mint(&other_mint);
    let ix = env.ix_create_shop(&owner.pubkey(), &other_mint, windows(), None);
    assert_err(env.send(&[ix], &[&owner]), "MintNotAllowed");
}

#[test]
fn create_shop_rejects_owner_as_arbiter() {
    let mut env = Env::new();
    let owner = env.funded();
    let mint = env.mint;
    let ix = env.ix_create_shop(&owner.pubkey(), &mint, windows(), Some(owner.pubkey()));
    assert_err(env.send(&[ix], &[&owner]), "ArbiterIsOwner");

    // The default arbiter is checked too.
    let mut p = env.params();
    p.default_arbiter = owner.pubkey();
    let admin = env.admin.insecure_clone();
    env.send(&[env.ix_set_config(&admin.pubkey(), p)], &[&admin])
        .unwrap();
    let ix = env.ix_create_shop(&owner.pubkey(), &mint, windows(), None);
    assert_err(env.send(&[ix], &[&owner]), "ArbiterIsOwner");
}

type SetWindow = fn(&mut ShopWindows, &kekal::ConfigLimits, i64);

#[test]
fn create_shop_window_limits_are_inclusive() {
    let l = limits();
    let cases: Vec<(SetWindow, &str)> = vec![
        (
            |w, l, d| w.response_secs = l.min_response_secs + d,
            "ResponseWindowOutOfRange",
        ),
        (
            |w, l, d| w.response_secs = l.max_response_secs - d,
            "ResponseWindowOutOfRange",
        ),
        (
            |w, l, d| w.repair_secs = l.min_repair_secs + d,
            "RepairWindowOutOfRange",
        ),
        (
            |w, l, d| w.repair_secs = l.max_repair_secs - d,
            "RepairWindowOutOfRange",
        ),
        (
            |w, l, d| w.dispute_secs = l.min_dispute_secs + d,
            "DisputeWindowOutOfRange",
        ),
        (
            |w, l, d| w.dispute_secs = l.max_dispute_secs - d,
            "DisputeWindowOutOfRange",
        ),
        (
            |w, l, d| w.heartbeat_secs = l.min_heartbeat_secs + d,
            "HeartbeatWindowOutOfRange",
        ),
        (
            |w, l, d| w.heartbeat_secs = l.max_heartbeat_secs - d,
            "HeartbeatWindowOutOfRange",
        ),
        (
            |w, l, d| w.grace_secs = l.max_grace_secs - d,
            "GraceOutOfRange",
        ),
        (|w, _, d| w.grace_secs = d, "GraceOutOfRange"),
    ];
    for (set, err) in cases {
        let mut env = Env::new();
        let mint = env.mint;
        // On the limit: accepted.
        let ok_owner = env.funded();
        let mut w = windows();
        set(&mut w, &l, 0);
        env.send(
            &[env.ix_create_shop(&ok_owner.pubkey(), &mint, w, None)],
            &[&ok_owner],
        )
        .unwrap();
        // One second past the limit: rejected.
        let bad_owner = env.funded();
        let mut w = windows();
        set(&mut w, &l, -1);
        let ix = env.ix_create_shop(&bad_owner.pubkey(), &mint, w, None);
        assert_err(env.send(&[ix], &[&bad_owner]), err);
    }
}

#[test]
fn update_profile_by_owner_only() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(0);
    env.set_time(T0 + 100);
    env.send(
        &[env.ix_update_profile(&owner.pubkey(), [5; 32])],
        &[&owner],
    )
    .unwrap();
    let shop: Shop = env.load(&shop_pda(&owner.pubkey()));
    assert_eq!(shop.profile_hash, [5; 32]);
    assert_eq!(shop.last_seen, T0 + 100);
    assert_eq!(shop.response_secs, windows().response_secs);

    let intruder = env.funded();
    let mut ix = env.ix_update_profile(&owner.pubkey(), [6; 32]);
    ix.accounts[0].pubkey = intruder.pubkey();
    assert!(env.send(&[ix], &[&intruder]).is_err());
}

#[test]
fn heartbeat_updates_last_seen_even_when_late() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(0);
    let w = windows();
    env.set_time(T0 + w.heartbeat_secs + w.grace_secs + 500);
    env.send(&[env.ix_heartbeat(&owner.pubkey())], &[&owner])
        .unwrap();
    let shop: Shop = env.load(&shop_pda(&owner.pubkey()));
    assert_eq!(shop.last_seen, T0 + w.heartbeat_secs + w.grace_secs + 500);
}

#[test]
fn heartbeat_rejects_dormant_shop_and_stranger() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(0);
    let shop_key = shop_pda(&owner.pubkey());

    let stranger = env.funded();
    let mut ix = env.ix_heartbeat(&owner.pubkey());
    ix.accounts[0].pubkey = stranger.pubkey();
    assert!(env.send(&[ix], &[&stranger]).is_err());

    env.poke::<Shop>(&shop_key, |s| s.status = shop_status::DORMANT);
    assert_err(
        env.send(&[env.ix_heartbeat(&owner.pubkey())], &[&owner]),
        "ShopDormant",
    );
}
