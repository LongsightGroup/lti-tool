ALTER TABLE "lti_clients" ADD COLUMN "tenant_id" varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE "lti_deployments" ADD COLUMN "tenant_id" varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE "lti_registration_sessions" ADD COLUMN "tenant_id" varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE "lti_sessions" ADD COLUMN "tenant_id" varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE "lti_registration_sessions" DROP CONSTRAINT "lti_registration_sessions_pkey";--> statement-breakpoint
ALTER TABLE "lti_registration_sessions" ADD CONSTRAINT "lti_registration_sessions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id");--> statement-breakpoint
ALTER TABLE "lti_sessions" DROP CONSTRAINT "lti_sessions_pkey";--> statement-breakpoint
ALTER TABLE "lti_sessions" ADD CONSTRAINT "lti_sessions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id");--> statement-breakpoint
ALTER TABLE "lti_nonces" ADD COLUMN "tenant_id" varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE "lti_nonces" DROP CONSTRAINT "lti_nonces_pkey";--> statement-breakpoint
ALTER TABLE "lti_nonces" ADD CONSTRAINT "lti_nonces_tenant_id_nonce_pk" PRIMARY KEY("tenant_id","nonce");--> statement-breakpoint
DROP INDEX "lti_clients_issuer_client_idx";--> statement-breakpoint
CREATE INDEX "lti_clients_issuer_client_idx" ON "lti_clients" USING btree ("tenant_id","client_id","iss");--> statement-breakpoint
DROP INDEX "lti_clients_iss_client_id_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "lti_clients_iss_client_id_uniq" ON "lti_clients" USING btree ("tenant_id","iss","client_id");--> statement-breakpoint
DROP INDEX "lti_deployments_deployment_id_idx";--> statement-breakpoint
CREATE INDEX "lti_deployments_deployment_id_idx" ON "lti_deployments" USING btree ("tenant_id","deployment_id");
