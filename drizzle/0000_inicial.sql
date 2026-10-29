CREATE TABLE "adelantos" (
	"id" text PRIMARY KEY NOT NULL,
	"comercio_id" text NOT NULL,
	"evaluacion_id" integer NOT NULL,
	"params_version" integer NOT NULL,
	"estado" text NOT NULL,
	"monto_usd" double precision NOT NULL,
	"plazo_dias" integer NOT NULL,
	"cargo_usd" double precision NOT NULL,
	"comision_usd" double precision NOT NULL,
	"total_usd" double precision NOT NULL,
	"retencion_pct" double precision NOT NULL,
	"saldo_usd" double precision NOT NULL,
	"tasa_desembolso" double precision,
	"monto_bs" double precision,
	"referencia_desembolso" text,
	"desembolsado_en" date,
	"vence_en" date,
	"ultimo_cierre" date,
	"aprobado_por" text,
	"motivo" text,
	"aceptado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"serial" text,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bitacora" (
	"id" serial PRIMARY KEY NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"accion" text NOT NULL,
	"detalle" text NOT NULL,
	"comercio_id" text
);
--> statement-breakpoint
CREATE TABLE "comercios" (
	"id" text PRIMARY KEY NOT NULL,
	"rif" text NOT NULL,
	"razon_social" text NOT NULL,
	"nombre_comercial" text NOT NULL,
	"telefono" text NOT NULL,
	"email" text NOT NULL,
	"disglobal" jsonb NOT NULL,
	"correcciones" jsonb,
	"confirmado_en" timestamp with time zone,
	"estado" text DEFAULT 'activo' NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comercios_rif_unique" UNIQUE("rif")
);
--> statement-breakpoint
CREATE TABLE "evaluaciones" (
	"id" serial PRIMARY KEY NOT NULL,
	"comercio_id" text NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"params_version" integer NOT NULL,
	"score" integer NOT NULL,
	"monto_max_usd" double precision NOT NULL,
	"detalle" jsonb NOT NULL,
	"vence" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" serial PRIMARY KEY NOT NULL,
	"adelanto_id" text NOT NULL,
	"fecha" date NOT NULL,
	"ventas_bs" double precision NOT NULL,
	"monto_bs" double precision NOT NULL,
	"tasa_bcv" double precision NOT NULL,
	"monto_usd" double precision NOT NULL,
	"saldo_usd" double precision NOT NULL,
	"origen" text NOT NULL,
	"registrado_por" text
);
--> statement-breakpoint
CREATE TABLE "parametros" (
	"id" serial PRIMARY KEY NOT NULL,
	"valores" jsonb NOT NULL,
	"estado" text NOT NULL,
	"nota" text NOT NULL,
	"propuesto_por" text NOT NULL,
	"propuesto_por_id" text NOT NULL,
	"propuesto_en" timestamp with time zone DEFAULT now() NOT NULL,
	"aprobado_por" text,
	"aprobado_en" timestamp with time zone,
	"vigente_desde" date NOT NULL,
	"motivo_rechazo" text
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"usuario_id" text NOT NULL,
	"serial" text,
	"expira" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasas_bcv" (
	"fecha" date PRIMARY KEY NOT NULL,
	"tasa" double precision NOT NULL,
	"fuente" text NOT NULL,
	"registrado_por" text
);
--> statement-breakpoint
CREATE TABLE "terminales" (
	"serial" text PRIMARY KEY NOT NULL,
	"comercio_id" text NOT NULL,
	"modelo" text NOT NULL,
	"verificada" boolean NOT NULL,
	"ultimo_uso" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"hash" text NOT NULL,
	"roles" jsonb NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "adel_comercio" ON "adelantos" USING btree ("comercio_id");--> statement-breakpoint
CREATE INDEX "eval_comercio" ON "evaluaciones" USING btree ("comercio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pago_dia" ON "pagos" USING btree ("adelanto_id","fecha","origen");--> statement-breakpoint
CREATE INDEX "pago_adelanto" ON "pagos" USING btree ("adelanto_id");