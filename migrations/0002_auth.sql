-- Sign-in (Better Auth), same layout as TrutiAI.
-- Roles: reader (default) | reviewer (can use the review console) | admin (reviewer + manages reviewers).
CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `email_verified` integer DEFAULT false NOT NULL,
  `image` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  `role` text DEFAULT 'reader' NOT NULL
);
CREATE UNIQUE INDEX `user_email_idx` ON `user` (`email`);

CREATE TABLE `session` (
  `id` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `token` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  `ip_address` text,
  `user_agent` text,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX `session_token_idx` ON `session` (`token`);
CREATE INDEX `session_user_idx` ON `session` (`user_id`);

CREATE TABLE `account` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `access_token` text,
  `refresh_token` text,
  `id_token` text,
  `access_token_expires_at` integer,
  `refresh_token_expires_at` integer,
  `scope` text,
  `password` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE INDEX `account_user_idx` ON `account` (`user_id`);

CREATE TABLE `verification` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
