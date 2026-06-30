DROP INDEX `expires_at_idx` ON `registrationSessions`;--> statement-breakpoint
CREATE INDEX `reg_sessions_expires_at_idx` ON `registrationSessions` (`expiresAt`);