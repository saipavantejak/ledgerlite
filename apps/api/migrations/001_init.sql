CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','ok','drift')),
  checks JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE reconciliation_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES reconciliation_runs(id),
  check_name TEXT NOT NULL,
  detail TEXT NOT NULL,
  found_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION check_transaction_balanced() RETURNS trigger AS $$
DECLARE
  net BIGINT;
  n INT;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount_cents ELSE -amount_cents END),0), COUNT(*)
    INTO net, n
    FROM journal_entries WHERE transaction_id = NEW.transaction_id;
  IF n < 2 THEN RAISE EXCEPTION 'transaction must have at least 2 entries'; END IF;
  IF net <> 0 THEN RAISE EXCEPTION 'transaction out of balance: net %', net; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_transaction_balanced
AFTER INSERT ON journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_transaction_balanced();

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is immutable: use a reversing entry';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_transactions_immutable BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE VIEW account_balances AS
SELECT a.id AS account_id, a.code, a.name,
  COALESCE(SUM(CASE WHEN e.direction='debit' THEN e.amount_cents ELSE -e.amount_cents END),0) AS balance_cents
FROM accounts a LEFT JOIN journal_entries e ON e.account_id = a.id
GROUP BY a.id, a.code, a.name;
