-- ReferralTask.referralId is a foreign key (ON DELETE CASCADE) with no index:
-- deleting a Referral would scan the whole task table. fk-indexes.e2e-spec.ts.
CREATE INDEX "ReferralTask_referralId_idx" ON "ReferralTask"("referralId");
