ALTER TABLE kirby_player
  ADD COLUMN lock_expires_at TIMESTAMP(3) NULL AFTER lock_state;
