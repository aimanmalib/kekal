//! Builders and a ready-made fixture for the holder, claim and dispute instructions.

use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
    InstructionData, ToAccountMetas,
};
use anchor_spl::{associated_token, token::spl_token};
use solana_keypair::Keypair;
use solana_signer::Signer;

use super::{config_pda, pda, shop_pda, vault_pda, warranty_pda, Env, T0};

pub fn claim_pda(warranty: &Pubkey, index: u16) -> Pubkey {
    pda(&[kekal::CLAIM_SEED, warranty.as_ref(), &index.to_le_bytes()])
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    associated_token::get_associated_token_address(owner, mint)
}

/// Shop with one issued warranty. The holder has no SOL: a relayer pays every fee and rent.
pub struct Fx {
    pub owner: Keypair,
    pub holder: Keypair,
    pub relayer: Keypair,
    pub shop: Pubkey,
    pub warranty: Pubkey,
    pub reserve: u64,
}

impl Fx {
    pub fn claim(&self, index: u16) -> Pubkey {
        claim_pda(&self.warranty, index)
    }
}

pub enum HolderAction {
    Confirm,
    Escalate,
}

impl Env {
    /// Clock at T0, warranty 0 issued (term 3600 s, reserve 400 of 1 000 deposited).
    pub fn fixture() -> (Env, Fx) {
        let mut env = Env::new();
        let (owner, _) = env.shop_with(1_000);
        let holder = Keypair::new();
        let relayer = env.funded();
        env.send(
            &[env.ix_issue(&owner.pubkey(), env.issue_params(&holder.pubkey(), 400))],
            &[&owner],
        )
        .unwrap();
        let shop = shop_pda(&owner.pubkey());
        let fx = Fx {
            warranty: warranty_pda(&shop, 0),
            shop,
            owner,
            holder,
            relayer,
            reserve: 400,
        };
        assert_eq!(env.svm.get_sysvar::<super::Clock>().unix_timestamp, T0);
        (env, fx)
    }

    /// Files the next claim at time `t` through the relayer; returns the claim address.
    pub fn file_at(&mut self, fx: &Fx, t: i64) -> Pubkey {
        self.set_time(t);
        let ix = self.ix_file_claim(&fx.relayer.pubkey(), &fx.holder.pubkey(), &fx.warranty);
        let claim = ix.accounts[5].pubkey;
        self.send(&[ix], &[&fx.relayer, &fx.holder]).unwrap();
        claim
    }

    pub fn respond_at(
        &mut self,
        fx: &Fx,
        claim: &Pubkey,
        t: i64,
        accept: bool,
    ) -> Result<(), String> {
        self.set_time(t);
        let ix = self.ix_respond(&fx.owner.pubkey(), &fx.warranty, claim, accept);
        self.send(&[ix], &[&fx.owner])
    }

    pub fn holder_act(&mut self, fx: &Fx, claim: &Pubkey, act: HolderAction) -> Result<(), String> {
        let ix = self.ix_holder_claim(act, &fx.holder.pubkey(), &fx.shop, &fx.warranty, claim);
        self.send(&[ix], &[&fx.relayer, &fx.holder])
    }

    pub fn ix_transfer_holder(
        &self,
        holder: &Pubkey,
        warranty: &Pubkey,
        new_holder: Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            kekal::id(),
            &kekal::instruction::TransferHolder { new_holder }.data(),
            kekal::accounts::TransferHolder {
                holder: *holder,
                warranty: *warranty,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_file_claim(&self, payer: &Pubkey, holder: &Pubkey, warranty: &Pubkey) -> Instruction {
        let w: kekal::Warranty = self.load(warranty);
        Instruction::new_with_bytes(
            kekal::id(),
            &kekal::instruction::FileClaim {
                evidence_hash: [5; 32],
            }
            .data(),
            kekal::accounts::FileClaim {
                payer: *payer,
                holder: *holder,
                config: config_pda(),
                shop: w.shop,
                warranty: *warranty,
                claim: claim_pda(warranty, w.claim_count),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_respond(
        &self,
        owner: &Pubkey,
        warranty: &Pubkey,
        claim: &Pubkey,
        accept: bool,
    ) -> Instruction {
        Instruction::new_with_bytes(
            kekal::id(),
            &kekal::instruction::RespondClaim {
                accept,
                response_hash: [6; 32],
            }
            .data(),
            kekal::accounts::RespondClaim {
                owner: *owner,
                shop: shop_pda(owner),
                warranty: *warranty,
                claim: *claim,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_holder_claim(
        &self,
        act: HolderAction,
        holder: &Pubkey,
        shop: &Pubkey,
        warranty: &Pubkey,
        claim: &Pubkey,
    ) -> Instruction {
        let data = match act {
            HolderAction::Confirm => kekal::instruction::ConfirmResolved {}.data(),
            HolderAction::Escalate => kekal::instruction::Escalate {}.data(),
        };
        let metas = kekal::accounts::HolderClaim {
            holder: *holder,
            shop: *shop,
            warranty: *warranty,
            claim: *claim,
        };
        Instruction::new_with_bytes(kekal::id(), &data, metas.to_account_metas(None))
    }

    /// Payout accounts for the warranty's current holder (override `holder` to test a mismatch).
    pub fn payout_metas(
        &self,
        payer: &Pubkey,
        shop: &Pubkey,
        holder: &Pubkey,
    ) -> kekal::accounts::PayoutAccounts {
        kekal::accounts::PayoutAccounts {
            payer: *payer,
            mint: self.mint,
            vault: vault_pda(shop),
            holder: *holder,
            holder_token: ata(holder, &self.mint),
            token_program: spl_token::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        }
    }

    pub fn ix_resolve(
        &self,
        payer: &Pubkey,
        arbiter: &Pubkey,
        warranty: &Pubkey,
        claim: &Pubkey,
        buyer_wins: bool,
    ) -> Instruction {
        let w: kekal::Warranty = self.load(warranty);
        Instruction::new_with_bytes(
            kekal::id(),
            &kekal::instruction::ResolveDispute { buyer_wins }.data(),
            kekal::accounts::ResolveDispute {
                arbiter: *arbiter,
                shop: w.shop,
                warranty: *warranty,
                claim: *claim,
                payout: self.payout_metas(payer, &w.shop, &w.holder),
            }
            .to_account_metas(None),
        )
    }
}
