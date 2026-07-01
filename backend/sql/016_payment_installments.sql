ALTER TABLE payments
	ADD COLUMN IF NOT EXISTS base_amount_cents BIGINT;

ALTER TABLE payments
	ADD COLUMN IF NOT EXISTS finance_charge_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE payments
	ADD COLUMN IF NOT EXISTS installment_months INT NOT NULL DEFAULT 1;

ALTER TABLE payments
	ADD COLUMN IF NOT EXISTS installment_amount_cents BIGINT;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'payments_installments_check'
	) THEN
		ALTER TABLE payments
			ADD CONSTRAINT payments_installments_check
			CHECK (installment_months IN (1, 3, 6, 9, 12));
	END IF;
END $$;

UPDATE payments
SET
	base_amount_cents = COALESCE(base_amount_cents, amount_cents),
	installment_amount_cents = COALESCE(installment_amount_cents, amount_cents)
WHERE base_amount_cents IS NULL
	OR installment_amount_cents IS NULL;

INSERT INTO payment_types (name)
VALUES ('cash'), ('card_credit'), ('card_debit')
ON CONFLICT (name) DO NOTHING;
