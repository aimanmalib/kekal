//! Seeded random walks over every instruction, checking invariants I1 to I4 after each step.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use common::*;
use kekal::{warranty_status, IssueParams, Shop, Warranty};
use solana_keypair::Keypair;
use solana_signer::Signer;

const STEPS: usize = 200;
const SEEDS: [u64; 4] = [1, 7, 42, 2026];
const SHOPS: usize = 3;

/// SplitMix64: small, deterministic and dependency-free.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<T: Copy>(&mut self, items: &[T]) -> Option<T> {
        (!items.is_empty()).then(|| items[self.below(items.len() as u64) as usize])
    }
}

struct ShopActor {
    owner: Keypair,
    owner_token: Pubkey,
    key: Pubkey,
    issued_reserve: u64,
}

struct WarrantyActor {
    shop: usize,
    key: Pubkey,
    holder: Keypair,
    last_status: u8,
}

#[derive(Default)]
struct Tally {
    ok: usize,
    paid: usize,
    released: usize,
    dormant: usize,
    attacks: usize,
}

struct Walk {
    env: Env,
    rng: Rng,
    now: i64,
    relayer: Keypair,
    stranger: Keypair,
    shops: Vec<ShopActor>,
    warranties: Vec<WarrantyActor>,
    holders_ever: Vec<Pubkey>,
    tally: Tally,
}

fn locked_or_claimed(status: u8) -> bool {
    status == warranty_status::ACTIVE || status == warranty_status::CLAIMED
}

impl Walk {
    fn new(seed: u64) -> Self {
        let mut env = Env::new();
        let shops = (0..SHOPS)
            .map(|_| {
                let (owner, owner_token) = env.shop_with(5_000);
                let key = shop_pda(&owner.pubkey());
                ShopActor {
                    owner,
                    owner_token,
                    key,
                    issued_reserve: 0,
                }
            })
            .collect();
        let relayer = env.funded();
        let stranger = env.funded();
        Walk {
            env,
            rng: Rng(seed),
            now: T0,
            relayer,
            stranger,
            shops,
            warranties: Vec::new(),
            holders_ever: Vec::new(),
            tally: Tally::default(),
        }
    }

    fn warranty(&self, i: usize) -> Warranty {
        self.env.load(&self.warranties[i].key)
    }

    /// Indexes of warranties whose on-chain status is in `wanted`.
    fn with_status(&self, wanted: &[u8]) -> Vec<usize> {
        (0..self.warranties.len())
            .filter(|&i| wanted.contains(&self.warranty(i).status))
            .collect()
    }

    fn open_claim(&self, i: usize) -> Pubkey {
        claim_pda(&self.warranties[i].key, self.warranty(i).open_claim)
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> bool {
        let ok = self.env.send(&[ix], signers).is_ok();
        self.tally.ok += ok as usize;
        ok
    }

    fn step(&mut self) {
        self.now += 1 + self.rng.below(10) as i64;
        self.env.set_time(self.now);
        let s = self.rng.below(SHOPS as u64) as usize;
        let owner = self.shops[s].owner.insecure_clone();
        let relayer = self.relayer.insecure_clone();
        let stranger = self.stranger.insecure_clone();
        let live = self.with_status(&[warranty_status::ACTIVE, warranty_status::CLAIMED]);
        let claimed = self.with_status(&[warranty_status::CLAIMED]);
        match self.rng.below(16) {
            0 | 1 => self.issue(s),
            2 => {
                let amount = 1 + self.rng.below(500);
                let ix = self
                    .env
                    .ix_deposit(&owner.pubkey(), &self.shops[s].owner_token, amount);
                self.send(ix, &[&owner]);
            }
            3 => {
                let amount = 1 + self.rng.below(800);
                let ix = self
                    .env
                    .ix_withdraw(&owner.pubkey(), &self.shops[s].owner_token, amount);
                self.send(ix, &[&owner]);
            }
            4 => {
                let ix = self.env.ix_heartbeat(&owner.pubkey());
                self.send(ix, &[&owner]);
            }
            5 => {
                if let Some(i) = self.rng.pick(&live) {
                    let w = &self.warranties[i];
                    let ix = self
                        .env
                        .ix_file_claim(&relayer.pubkey(), &w.holder.pubkey(), &w.key);
                    let holder = w.holder.insecure_clone();
                    self.send(ix, &[&relayer, &holder]);
                }
            }
            6 => {
                if let Some(i) = self.rng.pick(&claimed) {
                    let owner = self.shops[self.warranties[i].shop].owner.insecure_clone();
                    let accept = self.rng.below(2) == 0;
                    let claim = self.open_claim(i);
                    let ix = self.env.ix_respond(
                        &owner.pubkey(),
                        &self.warranties[i].key,
                        &claim,
                        accept,
                    );
                    self.send(ix, &[&owner]);
                }
            }
            7 => {
                if let Some(i) = self.rng.pick(&claimed) {
                    let act = if self.rng.below(2) == 0 {
                        HolderAction::Confirm
                    } else {
                        HolderAction::Escalate
                    };
                    let w = &self.warranties[i];
                    let shop = self.shops[w.shop].key;
                    let claim = self.open_claim(i);
                    let ix =
                        self.env
                            .ix_holder_claim(act, &w.holder.pubkey(), &shop, &w.key, &claim);
                    let holder = w.holder.insecure_clone();
                    self.send(ix, &[&relayer, &holder]);
                }
            }
            8 => {
                if let Some(i) = self.rng.pick(&claimed) {
                    let arbiter = self.env.arbiter.insecure_clone();
                    let claim = self.open_claim(i);
                    let buyer_wins = self.rng.below(2) == 0;
                    let ix = self.env.ix_resolve(
                        &relayer.pubkey(),
                        &arbiter.pubkey(),
                        &self.warranties[i].key,
                        &claim,
                        buyer_wins,
                    );
                    self.send(ix, &[&relayer, &arbiter]);
                }
            }
            9 => {
                if let Some(i) = self.rng.pick(&claimed) {
                    let claim = self.open_claim(i);
                    let key = self.warranties[i].key;
                    let ix = match self.rng.below(3) {
                        0 => {
                            self.env
                                .ix_settle(Settle::Unanswered, &stranger.pubkey(), &key, &claim)
                        }
                        1 => self.env.ix_settle(
                            Settle::StaleDispute,
                            &stranger.pubkey(),
                            &key,
                            &claim,
                        ),
                        _ => self.env.ix_close_stale(&key, &claim),
                    };
                    self.send(ix, &[&stranger]);
                }
            }
            10 => {
                let ix = self.env.ix_declare_dormant(&self.shops[s].key);
                if self.send(ix, &[&stranger]) {
                    self.tally.dormant += 1;
                }
            }
            11 => {
                if let Some(i) = self.rng.pick(&live) {
                    let claim = (self.warranty(i).status == warranty_status::CLAIMED)
                        .then(|| self.open_claim(i));
                    let key = self.warranties[i].key;
                    let ix = self.env.ix_claim_orphan(&stranger.pubkey(), &key, claim);
                    self.send(ix, &[&stranger]);
                }
            }
            12 => {
                if let Some(i) = self.rng.pick(&live) {
                    let ix = self.env.ix_release(&self.warranties[i].key);
                    self.send(ix, &[&stranger]);
                }
            }
            13 => {
                if let Some(i) = self.rng.pick(&live) {
                    let next = Keypair::new();
                    let w = &self.warranties[i];
                    let ix = self
                        .env
                        .ix_transfer_holder(&w.holder.pubkey(), &w.key, next.pubkey());
                    let holder = w.holder.insecure_clone();
                    if self.send(ix, &[&relayer, &holder]) {
                        self.holders_ever.push(next.pubkey());
                        self.warranties[i].holder = next;
                    }
                }
            }
            14 => self.attack(s, &live),
            _ => {
                self.now += 1 + self.rng.below(300) as i64;
                self.env.set_time(self.now);
            }
        }
    }

    fn issue(&mut self, s: usize) {
        let owner = self.shops[s].owner.insecure_clone();
        let holder = Keypair::new();
        let reserve = 1 + self.rng.below(300);
        let params = IssueParams {
            holder: holder.pubkey(),
            reserve,
            term_secs: 300 + self.rng.below(1_500) as i64,
            terms_hash: [7; 32],
            product_hash: [9; 32],
        };
        let shop = self.shops[s].key;
        let id = self.env.load::<Shop>(&shop).next_warranty_id;
        let ix = self.env.ix_issue(&owner.pubkey(), params);
        if self.send(ix, &[&owner]) {
            self.shops[s].issued_reserve += reserve;
            self.holders_ever.push(holder.pubkey());
            self.warranties.push(WarrantyActor {
                shop: s,
                key: warranty_pda(&shop, id),
                holder,
                last_status: warranty_status::ACTIVE,
            });
        }
    }

    /// I4: a stranger can neither move a claim right nor take a shop's free balance.
    fn attack(&mut self, s: usize, live: &[usize]) {
        let stranger = self.stranger.insecure_clone();
        let relayer = self.relayer.insecure_clone();
        let target = self.rng.pick(live);
        let before = self.snapshot();
        let res = match (self.rng.below(4), target) {
            (0, Some(i)) => {
                let ix = self.env.ix_file_claim(
                    &relayer.pubkey(),
                    &stranger.pubkey(),
                    &self.warranties[i].key,
                );
                self.env.send(&[ix], &[&relayer, &stranger])
            }
            (1, Some(i)) => {
                let ix = self.env.ix_transfer_holder(
                    &stranger.pubkey(),
                    &self.warranties[i].key,
                    stranger.pubkey(),
                );
                self.env.send(&[ix], &[&stranger])
            }
            (2, Some(i)) if self.warranty(i).status == warranty_status::CLAIMED => {
                let claim = self.open_claim(i);
                let shop = self.shops[self.warranties[i].shop].key;
                let ix = self.env.ix_holder_claim(
                    HolderAction::Escalate,
                    &stranger.pubkey(),
                    &shop,
                    &self.warranties[i].key,
                    &claim,
                );
                self.env.send(&[ix], &[&stranger])
            }
            _ => {
                let mint = self.env.mint;
                let sink = self.env.put_token(&mint, &stranger.pubkey(), 0);
                let mut ix = self.env.ix_withdraw(&stranger.pubkey(), &sink, 1);
                ix.accounts[1].pubkey = self.shops[s].key;
                ix.accounts[3].pubkey = vault_pda(&self.shops[s].key);
                self.env.send(&[ix], &[&stranger])
            }
        };
        assert!(res.is_err(), "I4: stranger action succeeded");
        assert_eq!(before, self.snapshot(), "I4: failed attack changed state");
        self.tally.attacks += 1;
    }

    /// Every shop's books and every warranty's holder and status.
    fn snapshot(&self) -> Vec<(u64, u64, Pubkey, u8)> {
        let shops = self.shops.iter().map(|a| {
            let s: Shop = self.env.load(&a.key);
            (s.free_balance, s.locked_balance, s.owner, s.status)
        });
        let ws = self.warranties.iter().map(|a| {
            let w: Warranty = self.env.load(&a.key);
            (w.reserve, w.id, w.holder, w.status)
        });
        shops.chain(ws).collect()
    }

    fn check(&mut self) {
        for (s, actor) in self.shops.iter().enumerate() {
            let shop: Shop = self.env.load(&actor.key);
            let vault = self.env.token_amount(&vault_pda(&actor.key));
            // I1: the vault always covers the books.
            assert!(vault >= shop.free_balance + shop.locked_balance, "I1");
            // I2: locked equals the reserves of Active and Claimed warranties.
            let live: u64 = self
                .warranties
                .iter()
                .filter(|w| w.shop == s)
                .map(|w| self.env.load::<Warranty>(&w.key))
                .filter(|w| locked_or_claimed(w.status))
                .map(|w| w.reserve)
                .sum();
            assert_eq!(shop.locked_balance, live, "I2");
            // I3 (books): every issued reserve is still locked, or left exactly once.
            assert_eq!(
                actor.issued_reserve,
                shop.locked_balance + shop.paid_amount + shop.released_amount,
                "I3 books"
            );
        }
        // I3 (per warranty): Paid out or Released is final.
        for i in 0..self.warranties.len() {
            let now = self.warranty(i).status;
            let before = self.warranties[i].last_status;
            if !locked_or_claimed(before) {
                assert_eq!(now, before, "I3: warranty left its final state");
            } else if now == warranty_status::PAID_OUT {
                self.tally.paid += 1;
            } else if now == warranty_status::RELEASED {
                self.tally.released += 1;
            }
            self.warranties[i].last_status = now;
        }
        // Holders received exactly what the shops recorded as paid.
        let paid: u64 = self
            .shops
            .iter()
            .map(|a| self.env.load::<Shop>(&a.key).paid_amount)
            .sum();
        let mint = self.env.mint;
        let received: u64 = self
            .holders_ever
            .iter()
            .map(|h| ata(h, &mint))
            .filter(|a| self.env.svm.get_account(a).is_some())
            .map(|a| self.env.token_amount(&a))
            .sum();
        assert_eq!(paid, received, "holders received the recorded payouts");
    }
}

#[test]
fn invariants_hold_over_seeded_random_walks() {
    let mut total = Tally::default();
    for seed in SEEDS {
        let mut walk = Walk::new(seed);
        for _ in 0..STEPS {
            walk.step();
            walk.check();
        }
        let t = &walk.tally;
        total.ok += t.ok;
        total.paid += t.paid;
        total.released += t.released;
        total.dormant += t.dormant;
        total.attacks += t.attacks;
    }
    println!(
        "walks: {} seeds x {STEPS} steps, ok {}, paid {}, released {}, dormant {}, attacks {}",
        SEEDS.len(),
        total.ok,
        total.paid,
        total.released,
        total.dormant,
        total.attacks
    );
    // The walks must actually reach the interesting states, or the invariants prove little.
    assert!(total.ok >= 200, "successful steps: {}", total.ok);
    assert!(total.paid > 0, "no payout reached");
    assert!(total.released > 0, "no release reached");
    assert!(total.dormant > 0, "no shop went dormant");
    assert!(total.attacks > 0, "no attack attempted");
}
