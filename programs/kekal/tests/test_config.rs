mod common;

use common::*;
use kekal::Config;
use solana_signer::Signer;

#[test]
fn init_config_stores_admin_and_limits() {
    let env = Env::new();
    let c: Config = env.load(&config_pda());
    assert_eq!(c.admin, env.admin.pubkey());
    assert_eq!(c.default_arbiter, env.arbiter.pubkey());
    assert_eq!(c.limits, limits());
    assert_eq!(c.allowed_mints[0], env.mint);
    assert!(!c.paused);
}

#[test]
fn init_config_only_once() {
    let mut env = Env::new();
    let other = env.funded();
    let ix = env.ix_init_config(&other.pubkey(), env.params());
    assert_err(env.send(&[ix], &[&other]), "already in use");
}

#[test]
fn init_config_rejects_bad_limits() {
    let cases: Vec<fn(&mut kekal::ConfigLimits)> = vec![
        |l| l.min_response_secs = 0,
        |l| l.min_repair_secs = l.max_repair_secs + 1,
        |l| l.min_dispute_secs = -1,
        |l| l.max_heartbeat_secs = l.min_heartbeat_secs - 1,
        |l| l.min_term_secs = 0,
        |l| l.max_grace_secs = -1,
        |l| l.dispute_timeout_secs = 0,
        |l| l.claim_cooldown_secs = -1,
        |l| l.max_claims_per_warranty = 0,
    ];
    for mutate in cases {
        let mut env = Env::bare();
        let mut p = env.params();
        mutate(&mut p.limits);
        let admin = env.admin.insecure_clone();
        let ix = env.ix_init_config(&admin.pubkey(), p);
        assert_err(env.send(&[ix], &[&admin]), "InvalidLimits");
    }
}

#[test]
fn set_config_by_admin_updates() {
    let mut env = Env::new();
    let mut p = env.params();
    p.paused = true;
    p.limits.claim_cooldown_secs = 45;
    let admin = env.admin.insecure_clone();
    env.send(&[env.ix_set_config(&admin.pubkey(), p)], &[&admin])
        .unwrap();
    let c: Config = env.load(&config_pda());
    assert!(c.paused);
    assert_eq!(c.limits.claim_cooldown_secs, 45);
    assert_eq!(c.admin, admin.pubkey());
}

#[test]
fn set_config_rejects_non_admin_and_bad_limits() {
    let mut env = Env::new();
    let intruder = env.funded();
    let ix = env.ix_set_config(&intruder.pubkey(), env.params());
    assert_err(env.send(&[ix], &[&intruder]), "ConstraintHasOne");

    let mut p = env.params();
    p.limits.min_term_secs = p.limits.max_term_secs + 1;
    let admin = env.admin.insecure_clone();
    assert_err(
        env.send(&[env.ix_set_config(&admin.pubkey(), p)], &[&admin]),
        "InvalidLimits",
    );
}

#[test]
fn pause_blocks_new_shops_and_warranties() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(1_000);
    let mut p = env.params();
    p.paused = true;
    let admin = env.admin.insecure_clone();
    env.send(&[env.ix_set_config(&admin.pubkey(), p)], &[&admin])
        .unwrap();

    let ix = env.ix_issue(&owner.pubkey(), env.issue_params(&owner.pubkey(), 10));
    assert_err(env.send(&[ix], &[&owner]), "Paused");
    let late = env.funded();
    let mint = env.mint;
    let ix = env.ix_create_shop(&late.pubkey(), &mint, windows(), None);
    assert_err(env.send(&[ix], &[&late]), "Paused");
    // Owners keep control of their free balance while paused.
    env.send(&[env.ix_heartbeat(&owner.pubkey())], &[&owner])
        .unwrap();
}
