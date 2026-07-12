ALTER TABLE `lti_clients` ADD `tenant_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `lti_deployments` ADD `tenant_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `lti_registration_sessions` ADD `tenant_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `lti_sessions` ADD `tenant_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `lti_registration_sessions` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `lti_registration_sessions` ADD PRIMARY KEY (`tenant_id`, `id`);--> statement-breakpoint
ALTER TABLE `lti_sessions` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `lti_sessions` ADD PRIMARY KEY (`tenant_id`, `id`);--> statement-breakpoint
ALTER TABLE `lti_nonces` ADD `tenant_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `lti_nonces` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `lti_nonces` ADD PRIMARY KEY (`tenant_id`, `nonce`);--> statement-breakpoint
DROP INDEX `lti_clients_issuer_client_idx` ON `lti_clients`;--> statement-breakpoint
CREATE INDEX `lti_clients_issuer_client_idx` ON `lti_clients` (`tenant_id`,`client_id`,`iss`);--> statement-breakpoint
ALTER TABLE `lti_clients` DROP INDEX `lti_clients_iss_client_id_uniq`;--> statement-breakpoint
ALTER TABLE `lti_clients` ADD CONSTRAINT `lti_clients_iss_client_id_uniq` UNIQUE(`tenant_id`,`iss`,`client_id`);--> statement-breakpoint
DROP INDEX `lti_deployments_deployment_id_idx` ON `lti_deployments`;--> statement-breakpoint
CREATE INDEX `lti_deployments_deployment_id_idx` ON `lti_deployments` (`tenant_id`,`deployment_id`);
