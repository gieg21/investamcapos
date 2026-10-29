CREATE TABLE "informes" (
	"id" serial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"texto" text NOT NULL,
	"datos" jsonb NOT NULL,
	"motor" text NOT NULL,
	"hex" text,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "informes_fecha_unique" UNIQUE("fecha")
);
--> statement-breakpoint
CREATE TABLE "notificaciones" (
	"id" text PRIMARY KEY NOT NULL,
	"comercio_id" text NOT NULL,
	"adelanto_id" text,
	"tipo" text NOT NULL,
	"clave" text NOT NULL,
	"titulo" text NOT NULL,
	"mensaje" text NOT NULL,
	"monto_usd" double precision,
	"monto_bs" double precision,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"reporte" jsonb,
	"redactado_por" text NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recomendaciones" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"objetivo_id" text NOT NULL,
	"comercio_id" text NOT NULL,
	"decision" text NOT NULL,
	"confianza" double precision NOT NULL,
	"resumen" text NOT NULL,
	"detalle" jsonb NOT NULL,
	"motores" jsonb NOT NULL,
	"aplicada" boolean DEFAULT false NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notif_clave" ON "notificaciones" USING btree ("clave");--> statement-breakpoint
CREATE INDEX "notif_comercio" ON "notificaciones" USING btree ("comercio_id");--> statement-breakpoint
CREATE INDEX "rec_objetivo" ON "recomendaciones" USING btree ("tipo","objetivo_id");