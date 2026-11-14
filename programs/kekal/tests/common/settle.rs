//! Builders for the permissionless instructions 15 to 20 (keeper or anyone).

use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
};

use super::{config_pda, Env};

pub enum Settle {
    Unanswered,
    StaleDispute,
}

impl Env {
    /// `settle_unanswered` / `settle_stale_dispute`, paying the warranty's current holder.
    pub fn ix_settle(
        &self,
        kind: Settle,
        payer: &Pubkey,
        warranty: &Pubkey,
        claim: &Pubkey,
    ) -> Instruction {
        let w: kekal::Warranty = self.load(warranty);
        let data = match kind {
            Settle::Unanswered => kekal::instruction::SettleUnanswered {}.data(),
            Settle::StaleDispute => kekal::instruction::SettleStaleDispute {}.data(),
        };
        let metas = kekal::accounts::SettleClaim {
            config: config_pda(),
            shop: w.shop,
            warranty: *warranty,
            claim: *claim,
            payout: self.payout_metas(payer, &w.shop, &w.holder),
        };
        Instruction::new_with_bytes(kekal::id(), &data, metas.to_account_metas(None))
    }

    pub fn ix_close_stale(&self, warranty: &Pubkey, claim: &Pubkey) -> Instruction {
        let w: kekal::Warranty = self.load(warranty);
        let metas = kekal::accounts::CloseStale {
            shop: w.shop,
            warranty: *warranty,
            claim: *claim,
        };
        Instruction::new_with_bytes(
            kekal::id(),
            &kekal::instruction::CloseStale {}.data(),
            metas.to_account_metas(None),
        )
    }

    pub fn ix_declare_dormant(&self, shop: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            kekal::id(),
            &kekal::instruction::DeclareDormant {}.data(),
            kekal::accounts::DeclareDormant { shop: *shop }.to_account_metas(None),
        )
    }

    /// `claim_orphan`; pass `claim` for a Claimed warranty, `None` for an Active one.
    pub fn ix_claim_orphan(
        &self,
        payer: &Pubkey,
        warranty: &Pubkey,
        claim: Option<Pubkey>,
    ) -> Instruction {
        let w: kekal::Warranty = self.load(warranty);
        let metas = kekal::accounts::ClaimOrphan {
            shop: w.shop,
            warranty: *warranty,
            claim,
            payout: self.payout_metas(payer, &w.shop, &w.holder),
        };
        Instruction::new_with_bytes(
            kekal::id(),
            &kekal::instruction::ClaimOrphan {}.data(),
            metas.to_account_metas(None),
        )
    }

    pub fn ix_release(&self, warranty: &Pubkey) -> Instruction {
        let w: kekal::Warranty = self.load(warranty);
        let metas = kekal::accounts::ReleaseExpired {
            shop: w.shop,
            warranty: *warranty,
        };
        Instruction::new_with_bytes(
            kekal::id(),
            &kekal::instruction::ReleaseExpired {}.data(),
            metas.to_account_metas(None),
        )
    }
}

impl Env {
    /// Holder received the full reserve once and the shop's books match (I1 included).
    pub fn assert_paid(&self, fx: &super::Fx, open_claims_left: u32) {
        let s: kekal::Shop = self.load(&fx.shop);
        let w: kekal::Warranty = self.load(&fx.warranty);
        assert_eq!(w.status, kekal::warranty_status::PAID_OUT);
        assert_eq!(
            self.token_amount(&super::ata(&w.holder, &self.mint)),
            fx.reserve
        );
        assert_eq!((s.paid_count, s.paid_amount), (1, fx.reserve));
        assert_eq!(s.locked_balance, 0);
        assert_eq!((s.open_claims, s.active_warranties), (open_claims_left, 0));
        let vault = self.token_amount(&super::vault_pda(&fx.shop));
        assert!(vault >= s.free_balance + s.locked_balance);
    }
}
