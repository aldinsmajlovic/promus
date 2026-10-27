-- an invite to a household of one's own; household_id stays the inviter's, who can revoke it
ALTER TABLE invites ADD COLUMN own_household INTEGER NOT NULL DEFAULT 0;
