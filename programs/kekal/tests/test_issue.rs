mod common;

use common::*;
use kekal::{shop_status, warranty_status, Shop, Warranty};
use solana_signer::Signer;

#[test]
fn issue_locks_reserve_and_creates_warranty() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(1_000);
    let holder = env.funded();
    env.set_time(T0 + 10);
    env.send(
        &[env.ix_issue(&owner.pubkey(), env.issue_params(&holder.pubkey(), 400))],
        &[&owner],
    )
    .unwrap();
    let shop_key = shop_pda(&owner.pubkey());
    let shop: Shop = env.load(&shop_key);
    assert_eq!((shop.free_balance, shop.locked_balance), (600, 400));
    assert_eq!(
        (shop.next_warranty_id, shop.active_warranties, shop.issued),
        (1, 1, 1)
    );
    assert_eq!(shop.last_seen, T0 + 10);
    // I1: vault holds at least free + locked.
    assert!(env.token_amount(&shop.vault) >= shop.free_balance + shop.locked_balance);

    let w: Warranty = env.load(&warranty_pda(&shop_key, 0));
    assert_eq!(
        (w.shop, w.id, w.holder, w.reserve),
        (shop_key, 0, holder.pubkey(), 400)
    );
    assert_eq!((w.issued_at, w.expires_at), (T0 + 10, T0 + 10 + 3600));
    assert_eq!((w.terms_hash, w.product_hash), ([7; 32], [9; 32]));
    assert_eq!((w.status, w.claim_count), (warranty_status::ACTIVE, 0));
}

#[test]
fn issue_ids_increase_and_reserve_cannot_exceed_free() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(500);
    let h = env.funded().pubkey();
    env.send(
        &[env.ix_issue(&owner.pubkey(), env.issue_params(&h, 300))],
        &[&owner],
    )
    .unwrap();
    env.send(
        &[env.ix_issue(&owner.pubkey(), env.issue_params(&h, 200))],
        &[&owner],
    )
    .unwrap();
    let shop_key = shop_pda(&owner.pubkey());
    assert_eq!(
        env.load::<Warranty>(&warranty_pda(&shop_key, 1)).reserve,
        200
    );
    let ix = env.ix_issue(&owner.pubkey(), env.issue_params(&h, 1));
    assert_err(env.send(&[ix], &[&owner]), "InsufficientFreeBalance");
    let ix = env.ix_issue(&owner.pubkey(), env.issue_params(&h, 0));
    assert_err(env.send(&[ix], &[&owner]), "ZeroAmount");
    let shop: Shop = env.load(&shop_key);
    assert_eq!(
        (
            shop.free_balance,
            shop.locked_balance,
            shop.active_warranties
        ),
        (0, 500, 2)
    );
}

#[test]
fn issue_term_limits_are_inclusive() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(1_000);
    let h = env.funded().pubkey();
    let l = limits();
    for (term, ok) in [
        (l.min_term_secs, true),
        (l.min_term_secs - 1, false),
        (l.max_term_secs, true),
        (l.max_term_secs + 1, false),
    ] {
        let mut p = env.issue_params(&h, 10);
        p.term_secs = term;
        let res = env.send(&[env.ix_issue(&owner.pubkey(), p)], &[&owner]);
        if ok {
            res.unwrap();
        } else {
            assert_err(res, "TermOutOfRange");
        }
    }
}

#[test]
fn issue_heartbeat_boundary() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(1_000);
    let h = env.funded().pubkey();
    let w = windows();
    let deadline = T0 + w.heartbeat_secs + w.grace_secs;
    // Exactly at last_seen + heartbeat + grace: allowed (and refreshes last_seen).
    env.set_time(deadline);
    env.send(
        &[env.ix_issue(&owner.pubkey(), env.issue_params(&h, 10))],
        &[&owner],
    )
    .unwrap();
    // One second past the refreshed deadline: rejected.
    env.set_time(deadline + w.heartbeat_secs + w.grace_secs + 1);
    let ix = env.ix_issue(&owner.pubkey(), env.issue_params(&h, 10));
    assert_err(env.send(&[ix], &[&owner]), "HeartbeatLapsed");
    // A heartbeat restores the right to issue.
    env.send(&[env.ix_heartbeat(&owner.pubkey())], &[&owner])
        .unwrap();
    env.send(
        &[env.ix_issue(&owner.pubkey(), env.issue_params(&h, 10))],
        &[&owner],
    )
    .unwrap();
}

#[test]
fn issue_rejects_dormant_shop_and_stranger() {
    let mut env = Env::new();
    let (owner, _) = env.shop_with(1_000);
    let h = env.funded().pubkey();

    let stranger = env.funded();
    let mut ix = env.ix_issue(&owner.pubkey(), env.issue_params(&h, 10));
    ix.accounts[0].pubkey = stranger.pubkey();
    assert!(env.send(&[ix], &[&stranger]).is_err());

    env.poke::<Shop>(&shop_pda(&owner.pubkey()), |s| {
        s.status = shop_status::DORMANT
    });
    let ix = env.ix_issue(&owner.pubkey(), env.issue_params(&h, 10));
    assert_err(env.send(&[ix], &[&owner]), "ShopDormant");
}
