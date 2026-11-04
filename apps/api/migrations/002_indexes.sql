-- Not part of the data model: lookup indexes only (FK columns, reversal-linkage lookup, keyset pagination).
CREATE INDEX idx_journal_entries_transaction_id ON journal_entries (transaction_id);
CREATE INDEX idx_journal_entries_account_id ON journal_entries (account_id);
CREATE INDEX idx_transactions_reference ON transactions (reference);
CREATE INDEX idx_transactions_created_at_id ON transactions (created_at DESC, id DESC);
