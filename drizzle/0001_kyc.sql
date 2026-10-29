CREATE TABLE "kyc" (
	"id" text PRIMARY KEY NOT NULL,
	"comercio_id" text NOT NULL,
	"proveedor" text NOT NULL,
	"sesion_proveedor" text,
	"url_proveedor" text,
	"estado" text NOT NULL,
	"representante" jsonb NOT NULL,
	"resultado" jsonb,
	"checks" jsonb,
	"motivo" text,
	"decidido_por" text,
	"cuenta_intento" boolean DEFAULT true NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	"decidido" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "kyc_comercio" ON "kyc" USING btree ("comercio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_sesion" ON "kyc" USING btree ("sesion_proveedor");