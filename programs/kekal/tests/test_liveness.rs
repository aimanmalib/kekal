//! L1 (every non-final state has a time-bounded permissionless exit) and the claim_orphan
//! against release_expired race.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use common::*;
use kekal::{warranty_status, Shop, Warranty};
use solana_signer::Signer;

/// Fixture shop: R 60, P 120, D 90, H 600, G 60; dispute timeout 300; warranty expires T0 + 3600.
const SILENT_AFTER: i64 = T0 + 600 + 60;
const EXPIRES: i64 = T0 + 3600;

#[derive(Clone, Copy, Debug)]
enum Start {
    Pending,
    Accepted,
    Rejected,
    Disputed,
    SilentShop,
    PendingInSilentShop,
    Expired,
}

const STARTS: [Start; 7] = [
    Start::Pending,
    Start::Accepted,
    Start::Rejected,
    Start::Disputed,
    Start::SilentShop,
    Start::PendingInSilentShop,
    Start::Expired,
];

/// Puts the fixture warranty in `start`; returns the open claim, if any.
fn reach(env: &mut Env, fx: &Fx, start: Start) -> Option<Pubkey> {
    let claim = match start {
        Start::SilentShop | Start::Expired => return None,
        _ => env.file_at(fx, T0 + 10),
    };
    match start {
        Start::Accepted => env.respond_at(fx, &claim, T0 + 20, true).unwrap(),
        Start::Rejected => env.respond_at(fx, &claim, T0 + 20, false).unwrap(),
        Start::Disputed => {
            env.respond_at(fx, &claim, T0 + 20, false).unwrap();
            env.set_time(T0 + 30);
            env.holder_act(fx, &claim, HolderAction::Escalate).unwrap();
        }
        _ => {}
    }
    Some(claim)
}

/// The exit the spec names for `start`, at the first second it is allowed, plus the status the
/// warranty must reach.
fn exit(
    env: &mut Env,
    fx: &Fx,
    start: Start,
    claim: Option<Pubkey>,
) -> (i64, Vec<Instruction>, u8) {
    let payer = Pubkey::new_unique();
    let settle = |env: &Env, kind| env.ix_settle(kind, &payer, &fx.warranty, &claim.unwrap());
    let close = |env: &Env| env.ix_close_stale(&fx.warranty, &claim.unwrap());
    let paid = warranty_status::PAID_OUT;
    let active = warranty_status::ACTIVE;
    let (t, ixs, status) = match start {
        Start::Pending => (T0 + 10 + 61, vec![settle(env, Settle::Unanswered)], paid),
        Start::Accepted => (T0 + 20 + 120 + 90 + 1, vec![close(env)], active),
        Start::Rejected => (T0 + 20 + 90 + 1, vec![close(env)], active),
        Start::Disputed => (
            T0 + 30 + 300 + 1,
            vec![settle(env, Settle::StaleDispute)],
            paid,
        ),
        Start::SilentShop | Start::PendingInSilentShop => {
            let orphan = env.ix_claim_orphan(&payer, &fx.warranty, claim);
            (
                SILENT_AFTER + 1,
                vec![env.ix_declare_dormant(&fx.shop), orphan],
                paid,
            )
        }
        Start::Expired => {
            env.set_time(EXPIRES);
            let ix = env.ix_heartbeat(&fx.owner.pubkey());
            env.send(&[ix], &[&fx.owner]).unwrap();
            (
                EXPIRES + 1,
                vec![env.ix_release(&fx.warranty)],
                warranty_status::RELEASED,
            )
        }
    };
    (t, ixs, status)
}

/// Sends `ixs` signed and paid only by a fresh stranger (the payer key is swapped in).
fn as_stranger(env: &mut Env, mut ixs: Vec<Instruction>) -> Result<(), String> {
    let stranger = env.funded();
    for ix in ixs.iter_mut() {
        for meta in ix.accounts.iter_mut().filter(|m| m.is_signer) {
            meta.pubkey = stranger.pubkey();
        }
    }
    env.send(&ixs, &[&stranger])
}

fn is_final(status: u8) -> bool {
    status == warranty_status::PAID_OUT || status == warranty_status::RELEASED
}

/// Advances the clock and sends only permissionless instructions until the reserve leaves `locked`.
fn drain(env: &mut Env, fx: &Fx, mut now: i64) {
    for _ in 0..16 {
        let w: Warranty = env.load(&fx.warranty);
        if is_final(w.status) {
            let s: Shop = env.load(&fx.shop);
            assert_eq!(
                s.locked_balance, 0,
                "reserve still locked after a final state"
            );
            return;
        }
        now += 400;
        env.set_time(now);
        let payer = Pubkey::new_unique();
        let claim =
            (w.status == warranty_status::CLAIMED).then(|| claim_pda(&fx.warranty, w.open_claim));
        let mut tries = vec![
            env.ix_declare_dormant(&fx.shop),
            env.ix_release(&fx.warranty),
        ];
        tries.push(env.ix_claim_orphan(&payer, &fx.warranty, claim));
        if let Some(c) = claim {
            tries.push(env.ix_settle(Settle::Unanswered, &payer, &fx.warranty, &c));
            tries.push(env.ix_settle(Settle::StaleDispute, &payer, &fx.warranty, &c));
            tries.push(env.ix_close_stale(&fx.warranty, &c));
        }
        for ix in tries {
            let _ = as_stranger(env, vec![ix]);
        }
    }
    panic!("reserve never left locked through permissionless calls");
}

#[test]
fn every_non_final_state_has_its_permissionless_exit() {
    for start in STARTS {
        let (mut env, fx) = Env::fixture();
        let claim = reach(&mut env, &fx, start);
        let (t, ixs, want) = exit(&mut env, &fx, start, claim);
        env.set_time(t - 1);
        let early = as_stranger(&mut env, ixs.clone());
        assert!(early.is_err(), "{start:?}: exit allowed one second early");
        env.set_time(t);
        as_stranger(&mut env, ixs).unwrap_or_else(|e| panic!("{start:?}: exit refused\n{e}"));
        let w: Warranty = env.load(&fx.warranty);
        assert_eq!(w.status, want, "{start:?}");
        if want == warranty_status::PAID_OUT {
            env.assert_paid(&fx, 0);
        }
    }
}

#[test]
fn no_reserve_stays_locked_without_the_shop_or_holder() {
    for start in STARTS {
        let (mut env, fx) = Env::fixture();
        reach(&mut env, &fx, start);
        drain(&mut env, &fx, T0 + 40);
    }
}

fn dormant_then_expired() -> (Env, Fx) {
    let (mut env, fx) = Env::fixture();
    env.set_time(SILENT_AFTER + 1);
    {
        let ixs = vec![env.ix_declare_dormant(&fx.shop)];
        as_stranger(&mut env, ixs)
    }
    .unwrap();
    env.set_time(EXPIRES + 1);
    (env, fx)
}

fn expired_then_dormant() -> (Env, Fx) {
    let (mut env, fx) = Env::fixture();
    env.set_time(EXPIRES - 100);
    let ix = env.ix_heartbeat(&fx.owner.pubkey());
    env.send(&[ix], &[&fx.owner]).unwrap();
    env.set_time(EXPIRES - 100 + 661);
    {
        let ixs = vec![env.ix_declare_dormant(&fx.shop)];
        as_stranger(&mut env, ixs)
    }
    .unwrap();
    (env, fx)
}

fn orphan_ix(env: &Env, fx: &Fx) -> Instruction {
    env.ix_claim_orphan(&Pubkey::new_unique(), &fx.warranty, None)
}

/// Sends orphan and release as two racing keepers would, in `orphan_first` order.
fn race(env: &mut Env, fx: &Fx, orphan_first: bool) -> (Result<(), String>, Result<(), String>) {
    let (orphan, release) = (orphan_ix(env, fx), env.ix_release(&fx.warranty));
    if orphan_first {
        let a = as_stranger(env, vec![orphan]);
        (a, as_stranger(env, vec![release]))
    } else {
        let b = as_stranger(env, vec![release]);
        (as_stranger(env, vec![orphan]), b)
    }
}

#[test]
fn race_dormant_before_expiry_holder_wins_in_either_order() {
    for orphan_first in [true, false] {
        let (mut env, fx) = dormant_then_expired();
        let (orphan, release) = race(&mut env, &fx, orphan_first);
        orphan.unwrap();
        assert_err(
            release,
            if orphan_first {
                "WarrantyNotActive"
            } else {
                "OwedToHolder"
            },
        );
        env.assert_paid(&fx, 0);
    }
}

#[test]
fn race_expiry_before_dormant_shop_wins_in_either_order() {
    for orphan_first in [true, false] {
        let (mut env, fx) = expired_then_dormant();
        let (orphan, release) = race(&mut env, &fx, orphan_first);
        release.unwrap();
        // The expiry check comes first, so the loser sees the same reason in both orders.
        assert_err(orphan, "ExpiredBeforeDormant");
        let s: Shop = env.load(&fx.shop);
        assert_eq!(
            (s.locked_balance, s.released_amount, s.paid_count),
            (0, fx.reserve, 0)
        );
    }
}

#[test]
fn race_both_in_one_transaction_fails_whole_and_changes_nothing() {
    for (setup, orphan_first) in [
        (dormant_then_expired as fn() -> (Env, Fx), true),
        (dormant_then_expired, false),
        (expired_then_dormant, true),
        (expired_then_dormant, false),
    ] {
        let (mut env, fx) = setup();
        let before: Shop = env.load(&fx.shop);
        let (o, r) = (orphan_ix(&env, &fx), env.ix_release(&fx.warranty));
        let ixs = if orphan_first { vec![o, r] } else { vec![r, o] };
        assert!(as_stranger(&mut env, ixs).is_err());
        let after: Shop = env.load(&fx.shop);
        assert_eq!(
            (before.locked_balance, before.free_balance),
            (after.locked_balance, after.free_balance)
        );
        let w: Warranty = env.load(&fx.warranty);
        assert_eq!(w.status, warranty_status::ACTIVE);
    }
}

/// Spec row 18 sets `dormant_at` to the declaration time, so a silent shop nobody declared
/// before expiry gets the reserve back. The keeper must declare dormancy promptly (ADR 0005).
#[test]
fn undeclared_silence_does_not_block_release() {
    let (mut env, fx) = Env::fixture();
    env.set_time(EXPIRES + 1);
    {
        let ixs = vec![env.ix_release(&fx.warranty)];
        as_stranger(&mut env, ixs)
    }
    .unwrap();
    {
        let ixs = vec![env.ix_declare_dormant(&fx.shop)];
        as_stranger(&mut env, ixs)
    }
    .unwrap();
    assert_err(
        {
            let ixs = vec![orphan_ix(&env, &fx)];
            as_stranger(&mut env, ixs)
        },
        "ExpiredBeforeDormant",
    );
}
