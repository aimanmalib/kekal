//! Shared LiteSVM harness: fixed clock, packed token accounts, PDA helpers and instruction builders.
#![allow(dead_code)]

use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        clock::Clock, instruction::Instruction, program_option::COption, program_pack::Pack,
        system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::spl_token;
use kekal::{ConfigLimits, ConfigParams, IssueParams, ShopWindows};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub const T0: i64 = 1_800_000_000;
pub const DECIMALS: u8 = 6;
pub const DAY: i64 = 86_400;

/// Frozen fixture equal to the devnet limits in the spec (not read from app config).
pub fn limits() -> ConfigLimits {
    ConfigLimits {
        min_response_secs: 60,
        max_response_secs: 90 * DAY,
        min_repair_secs: 60,
        max_repair_secs: 90 * DAY,
        min_dispute_secs: 60,
        max_dispute_secs: 90 * DAY,
        min_heartbeat_secs: 60,
        max_heartbeat_secs: 180 * DAY,
        max_grace_secs: 30 * DAY,
        min_term_secs: 300,
        max_term_secs: 15 * 365 * DAY,
        dispute_timeout_secs: 300,
        claim_cooldown_secs: 30,
        max_claims_per_warranty: 8,
    }
}

pub fn windows() -> ShopWindows {
    ShopWindows {
        response_secs: 60,
        repair_secs: 120,
        dispute_secs: 90,
        heartbeat_secs: 600,
        grace_secs: 60,
    }
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub arbiter: Keypair,
    pub mint: Pubkey,
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &kekal::id()).0
}
pub fn config_pda() -> Pubkey {
    pda(&[kekal::CONFIG_SEED])
}
pub fn shop_pda(owner: &Pubkey) -> Pubkey {
    pda(&[kekal::SHOP_SEED, owner.as_ref()])
}
pub fn vault_pda(shop: &Pubkey) -> Pubkey {
    pda(&[kekal::VAULT_SEED, shop.as_ref()])
}
pub fn warranty_pda(shop: &Pubkey, id: u64) -> Pubkey {
    pda(&[kekal::WARRANTY_SEED, shop.as_ref(), &id.to_le_bytes()])
}

impl Env {
    /// Program loaded, clock at T0, one allowed mint, no config yet.
    pub fn bare() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/kekal.so"));
        svm.add_program(kekal::id(), bytes).unwrap();
        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
        let mut env = Env {
            svm,
            admin,
            arbiter: Keypair::new(),
            mint: Pubkey::new_unique(),
        };
        env.set_time(T0);
        let mint = env.mint;
        env.put_mint(&mint);
        env
    }

    /// Config initialised with the fixture limits.
    pub fn new() -> Self {
        let mut env = Self::bare();
        let admin = env.admin.insecure_clone();
        env.send(
            &[env.ix_init_config(&admin.pubkey(), env.params())],
            &[&admin],
        )
        .unwrap();
        env
    }

    pub fn params(&self) -> ConfigParams {
        ConfigParams {
            default_arbiter: self.arbiter.pubkey(),
            assessor: Pubkey::new_unique(),
            limits: limits(),
            allowed_mints: [
                self.mint,
                Pubkey::default(),
                Pubkey::default(),
                Pubkey::default(),
            ],
            paused: false,
        }
    }

    pub fn set_time(&mut self, t: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = t;
        self.svm.set_sysvar(&clock);
        self.svm.expire_blockhash();
    }

    pub fn funded(&mut self) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        k
    }

    pub fn put_mint(&mut self, mint: &Pubkey) {
        let state = spl_token::state::Mint {
            mint_authority: COption::Some(Pubkey::new_unique()),
            supply: u64::MAX / 2,
            decimals: DECIMALS,
            is_initialized: true,
            freeze_authority: COption::None,
        };
        let mut data = vec![0u8; spl_token::state::Mint::LEN];
        state.pack_into_slice(&mut data);
        self.put(mint, spl_token::ID, data);
    }

    /// Token account with `amount`, written directly (no mint authority needed).
    pub fn put_token(&mut self, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Pubkey {
        let key = Pubkey::new_unique();
        let state = spl_token::state::Account {
            mint: *mint,
            owner: *owner,
            amount,
            delegate: COption::None,
            state: spl_token::state::AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        };
        let mut data = vec![0u8; spl_token::state::Account::LEN];
        state.pack_into_slice(&mut data);
        self.put(&key, spl_token::ID, data);
        key
    }

    fn put(&mut self, key: &Pubkey, owner: Pubkey, data: Vec<u8>) {
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        let acc = Account {
            lamports,
            data,
            owner,
            executable: false,
            rent_epoch: 0,
        };
        self.svm.set_account(*key, acc).unwrap();
    }

    pub fn token_amount(&self, key: &Pubkey) -> u64 {
        let acc = self.svm.get_account(key).unwrap();
        spl_token::state::Account::unpack(&acc.data).unwrap().amount
    }

    pub fn load<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let acc = self.svm.get_account(key).unwrap();
        T::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    /// Sends one transaction; the first signer pays. Returns the program log on failure.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
        let msg = Message::new_with_blockhash(
            ixs,
            Some(&signers[0].pubkey()),
            &self.svm.latest_blockhash(),
        );
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        let res = self
            .svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| e.meta.logs.join("\n"));
        self.svm.expire_blockhash();
        res
    }

    /// Shop with fixture windows plus `deposit` tokens in its free balance; returns (owner, owner token account).
    pub fn shop_with(&mut self, deposit: u64) -> (Keypair, Pubkey) {
        let owner = self.funded();
        let mint = self.mint;
        let ata = self.put_token(&mint, &owner.pubkey(), 1_000_000_000);
        self.send(
            &[self.ix_create_shop(&owner.pubkey(), &mint, windows(), None)],
            &[&owner],
        )
        .unwrap();
        if deposit > 0 {
            self.send(
                &[self.ix_deposit(&owner.pubkey(), &ata, deposit)],
                &[&owner],
            )
            .unwrap();
        }
        (owner, ata)
    }

    pub fn issue_params(&self, holder: &Pubkey, reserve: u64) -> IssueParams {
        IssueParams {
            holder: *holder,
            reserve,
            term_secs: 3600,
            terms_hash: [7; 32],
            product_hash: [9; 32],
        }
    }

    // ---- instruction builders ----

    fn ix(
        data: Vec<u8>,
        metas: Vec<anchor_lang::solana_program::instruction::AccountMeta>,
    ) -> Instruction {
        Instruction::new_with_bytes(kekal::id(), &data, metas)
    }

    pub fn ix_init_config(&self, admin: &Pubkey, params: ConfigParams) -> Instruction {
        Self::ix(
            kekal::instruction::InitConfig { params }.data(),
            kekal::accounts::InitConfig {
                admin: *admin,
                config: config_pda(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_set_config(&self, admin: &Pubkey, params: ConfigParams) -> Instruction {
        Self::ix(
            kekal::instruction::SetConfig { params }.data(),
            kekal::accounts::SetConfig {
                admin: *admin,
                config: config_pda(),
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_create_shop(
        &self,
        owner: &Pubkey,
        mint: &Pubkey,
        windows: ShopWindows,
        arbiter: Option<Pubkey>,
    ) -> Instruction {
        let shop = shop_pda(owner);
        Self::ix(
            kekal::instruction::CreateShop {
                windows,
                arbiter,
                profile_hash: [1; 32],
            }
            .data(),
            kekal::accounts::CreateShop {
                owner: *owner,
                config: config_pda(),
                mint: *mint,
                shop,
                vault: vault_pda(&shop),
                token_program: spl_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_update_profile(&self, owner: &Pubkey, profile_hash: [u8; 32]) -> Instruction {
        Self::ix(
            kekal::instruction::UpdateShopProfile { profile_hash }.data(),
            kekal::accounts::OwnerShop {
                owner: *owner,
                shop: shop_pda(owner),
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_heartbeat(&self, owner: &Pubkey) -> Instruction {
        Self::ix(
            kekal::instruction::Heartbeat {}.data(),
            kekal::accounts::OwnerShop {
                owner: *owner,
                shop: shop_pda(owner),
            }
            .to_account_metas(None),
        )
    }

    pub fn move_metas(&self, owner: &Pubkey, owner_token: &Pubkey) -> kekal::accounts::MoveFunds {
        let shop = shop_pda(owner);
        kekal::accounts::MoveFunds {
            owner: *owner,
            shop,
            mint: self.mint,
            vault: vault_pda(&shop),
            owner_token: *owner_token,
            token_program: spl_token::ID,
        }
    }

    pub fn ix_deposit(&self, owner: &Pubkey, owner_token: &Pubkey, amount: u64) -> Instruction {
        Self::ix(
            kekal::instruction::Deposit { amount }.data(),
            self.move_metas(owner, owner_token).to_account_metas(None),
        )
    }

    pub fn ix_withdraw(&self, owner: &Pubkey, owner_token: &Pubkey, amount: u64) -> Instruction {
        Self::ix(
            kekal::instruction::Withdraw { amount }.data(),
            self.move_metas(owner, owner_token).to_account_metas(None),
        )
    }

    pub fn ix_issue(&self, owner: &Pubkey, params: IssueParams) -> Instruction {
        let shop = shop_pda(owner);
        let id = self
            .svm
            .get_account(&shop)
            .map(|_| self.load::<kekal::Shop>(&shop).next_warranty_id)
            .unwrap_or(0);
        Self::ix(
            kekal::instruction::IssueWarranty { params }.data(),
            kekal::accounts::IssueWarranty {
                owner: *owner,
                config: config_pda(),
                shop,
                warranty: warranty_pda(&shop, id),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }
}

/// Asserts a failed send carries the named Anchor error.
pub fn assert_err(res: Result<(), String>, name: &str) {
    match res {
        Ok(()) => panic!("expected error {name}, transaction succeeded"),
        Err(logs) => assert!(logs.contains(name), "expected {name}, logs:\n{logs}"),
    }
}

impl Env {
    /// Overwrites a program account's state (used to reach states owned by later instructions).
    pub fn poke<T: anchor_lang::AccountSerialize + AccountDeserialize>(
        &mut self,
        key: &Pubkey,
        f: impl FnOnce(&mut T),
    ) {
        let mut acc = self.svm.get_account(key).unwrap();
        let mut state = T::try_deserialize(&mut acc.data.as_slice()).unwrap();
        f(&mut state);
        let mut data = Vec::new();
        state.try_serialize(&mut data).unwrap();
        acc.data[..data.len()].copy_from_slice(&data);
        self.svm.set_account(*key, acc).unwrap();
    }
}
