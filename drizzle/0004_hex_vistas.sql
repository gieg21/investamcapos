-- Vistas de solo lectura para Hex (tableros de cartera). Sin datos personales: ni cédulas, ni cuentas, ni teléfonos.
CREATE OR REPLACE VIEW hex_cartera AS
SELECT a.id AS adelanto_id, c.rif, c.nombre_comercial, c.disglobal->>'actividad' AS actividad, c.disglobal->>'ciudad' AS ciudad,
       c.disglobal->>'estado' AS estado_geo, a.estado, a.monto_usd, a.plazo_dias, a.total_usd, a.saldo_usd, a.retencion_pct,
       a.tasa_desembolso, a.monto_bs, a.desembolsado_en, a.vence_en, a.creado, a.params_version
FROM adelantos a JOIN comercios c ON c.id = a.comercio_id;
--> statement-breakpoint
CREATE OR REPLACE VIEW hex_pagos AS
SELECT p.adelanto_id, p.fecha, p.ventas_bs, p.monto_bs, p.tasa_bcv, p.monto_usd, p.saldo_usd, p.origen
FROM pagos p;
--> statement-breakpoint
CREATE OR REPLACE VIEW hex_evaluaciones AS
SELECT e.comercio_id, e.fecha, e.score, e.monto_max_usd, e.params_version,
       (e.detalle->'metricas'->>'ventasMensualesUsd')::float AS ventas_mensuales_usd,
       e.detalle->'comportamiento'->>'clase' AS pago_ultimo_adelanto
FROM evaluaciones e;
--> statement-breakpoint
CREATE OR REPLACE VIEW hex_embudo AS
SELECT p.rif, p.actividad, p.ciudad, p.estado AS estado_geo, p.consultas, p.primera, p.ultima, p.comercio_id IS NOT NULL AS registrado,
       (SELECT k.estado FROM kyc k WHERE k.comercio_id = p.comercio_id ORDER BY k.creado DESC LIMIT 1) AS kyc
FROM prospectos p;
--> statement-breakpoint
CREATE OR REPLACE VIEW hex_uso AS SELECT comercio_id, fecha, interacciones FROM usos;
--> statement-breakpoint
CREATE OR REPLACE VIEW hex_agentes AS
SELECT r.tipo, r.decision, r.confianza, r.aplicada, r.motores->>'claude' AS claude, r.motores->>'jev' AS jev, r.creado FROM recomendaciones r;
