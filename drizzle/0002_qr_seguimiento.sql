CREATE TABLE "prospectos" (
	"rif" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"actividad" text NOT NULL,
	"ciudad" text NOT NULL,
	"estado" text NOT NULL,
	"serial" text,
	"consultas" integer DEFAULT 1 NOT NULL,
	"primera" timestamp with time zone DEFAULT now() NOT NULL,
	"ultima" timestamp with time zone DEFAULT now() NOT NULL,
	"comercio_id" text
);
--> statement-breakpoint
CREATE TABLE "usos" (
	"comercio_id" text NOT NULL,
	"fecha" date NOT NULL,
	"interacciones" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uso_dia" ON "usos" USING btree ("comercio_id","fecha");