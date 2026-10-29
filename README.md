# Investa · Adelanto de capital para POS Android de Disglobal (MCA)

Adelanto de capital (merchant cash advance) para comercios que cobran con un punto de venta Android de Disglobal (N62, N80, N82, N86, N92, AF910). El comercio lo pide desde el mismo POS y lo paga con un % de sus ventas diarias.

- **Onboarding solo con el RIF:** el comercio escribe su RIF en el POS; la ficha (razón social, representante, contacto, cuenta de liquidación, terminales) se trae de Disglobal y el comercio solo confirma. La terminal tiene que estar registrada a nombre de ese RIF en Disglobal (el serial se valida en el servidor), así nadie ve la ficha de otro comercio escribiendo su RIF.
- **KYC del representante legal:** antes de pedir el adelanto, la persona frente al POS se verifica con Didit (cédula, selfie y prueba de vida). La cédula verificada tiene que ser la del representante legal que Disglobal tiene para el RIF.
- **Scoring con la data transaccional de Disglobal:** ventas diarias en Bs convertidas a USD con la tasa BCV de cada día. Da un score de 0 a 100 y la oferta máxima entre USD 200 y 5.000.
- **Pagadero en Bs a tasa BCV:** la deuda está en USD; se desembolsa en Bs a la tasa BCV del día del desembolso y cada retención diaria en Bs abona al saldo a la tasa BCV del día del pago.
- **Capacidad que sube o baja:** el cupo se calcula con los ingresos de los últimos 3 meses y se ajusta según cómo pagó el último adelanto (frecuencia de abonos, ritmo frente al plazo y atraso).
- **Agentes de IA** en el backend: Claude (análisis y redacción), Jev de TypeSafe (decisión rápida y calibrada) y Hex (tableros). Analizan solicitudes y KYC dudosos, avisan el cobro voluntario cuando el comercio no vende por el POS, hacen seguimiento del registro y escriben el resumen diario.
- **Backoffice** con la misma estructura y gobierno que el de factoring de Investa: roles, doble aprobación de parámetros, versiones inmutables, bitácora y tasas BCV.

Stack igual al portal de factoring: Next.js 14 + API en `app/api` + PostgreSQL (Drizzle; PGlite embebido en desarrollo) + Tailwind con los tokens del Investa Brand Book (Blue Ribbon `#1955FA`, Cod Gray `#121212`, Wild Sand `#F5F5F5`, Space Grotesk + Inter).

## Ejecutar

```bash
npm install
npm run dev        # http://localhost:3000 · app del POS en /pos · backoffice en /admin
npm test           # scoring, precio y abonos en Bs
```

En desarrollo la base es PGlite en `.data/pg` y se siembra una demo: 4 usuarios del backoffice (contraseña `Investa2026!`, se entran con un clic desde `/admin/login`), ~14 meses de tasas BCV simuladas y tres comercios con cartera. `npm run db:reset` borra `.data`.

En `/pos`, sin terminal real, aparecen comercios de la base simulada de Disglobal para probar cada caso: oferta completa, oferta media, sin oferta por poca historia y suspendido en Disglobal. Cualquier otro RIF válido también devuelve datos simulados (y ~1 de cada 8 "no está afiliado").

Producción:

```bash
DATABASE_URL=postgres://… ADMIN_EMAIL=… ADMIN_PASSWORD=… DISGLOBAL_API_URL=… npm run build && npm start
```

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Postgres real. Sin ella se usa PGlite en `.data/pg`. |
| `INVESTA_DEMO` | `1` siembra la demo, simula Disglobal y la tasa BCV del día, y acepta terminales no registradas. Por defecto: activo en `dev`, apagado en `start`. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NOMBRE` | Primer Administrador cuando la base está vacía y no es demo. |
| `DIDIT_API_KEY` / `DIDIT_WORKFLOW_ID` | KYC con Didit (workflow con documento venezolano + prueba de vida + face match). Sin ellas, en demo el KYC se simula y fuera de demo el POS avisa que la verificación no está disponible. |
| `DIDIT_WEBHOOK_SECRET` | Firma del webhook `POST /api/kyc/didit` (HMAC-SHA256 del cuerpo, cabeceras `x-signature` y `x-timestamp`). |
| `DIDIT_API_URL` | Opcional: por defecto `https://verification.didit.me`. |
| `INVESTA_PUBLIC_URL` | URL pública del servidor, para que Didit devuelva a `/pos?kyc=listo`. Por defecto, el origen de la petición. |
| `ANTHROPIC_API_KEY` | Claude para los agentes (análisis, mensajes y resumen). `INVESTA_IA_MODEL` cambia el modelo (por defecto `claude-opus-5-5`). |
| `TYPESAFE_API_KEY` | Jev para las decisiones de los agentes. Opcionales: `TYPESAFE_API_URL` (por defecto `https://api.typesafe.ai/v1/systemone`), `TYPESAFE_MODEL` (por defecto `jev-latest`). |
| `HEX_API_TOKEN` / `HEX_PROJECT_ID` | Hex: el resumen diario corre el proyecto del tablero. Opcional: `HEX_API_URL`. Hex lee las vistas `hex_*` con un usuario de solo lectura. |
| `DISGLOBAL_API_URL` | API de Disglobal. **La integración real está pendiente** (`server/disglobal.ts`): fuera de demo, mientras no exista, el POS responde "Disglobal todavía no está conectado" en vez de usar datos inventados. |

Si cambias `server/db/schema.ts`: `npm run db:generate` crea la migración en `drizzle/`; se aplica sola al arrancar.

## Cómo funciona

```
POS Android (WebView, /android) ──▶ /pos ──▶ /api/pos/*  ──┐
                                                           ├──▶ server/* ──▶ PostgreSQL
Backoffice (/admin) ─────────────────────▶ /api/admin/* ──┘        │
                                                                   └──▶ Disglobal (ficha + ventas diarias)
```

### Flujo del comercio (app del POS)

1. **RIF** → `POST /api/pos/consulta { rif, serial }`: valida el dígito verificador, busca la ficha en Disglobal y comprueba que el serial de la terminal pertenece a ese RIF. Límite de 10 consultas fallidas por terminal cada 15 min.
2. **Confirmar** → `POST /api/pos/confirmar`: el comercio confirma los datos (puede cambiar teléfono y correo, o avisar que algo está mal; eso queda como "correcciones" para revisión). Se crea el comercio, se vincula la terminal, se abre la sesión del POS (cookie httpOnly de 30 días) y se corre el scoring.
3. **KYC del representante legal** → `POST /api/pos/kyc-iniciar`: si el comercio tiene oferta, se le pide que el representante legal (nombre y cédula enmascarada de Disglobal) verifique su identidad en Didit: cédula, selfie y prueba de vida. Se puede hacer **con el teléfono escaneando un QR** (recomendado: mejor cámara; es la única opción si el POS no tiene cámara) o en el mismo POS. Con el QR en pantalla el POS consulta cada 5 s; Didit vuelve a `/kyc/listo`, que regresa al POS o, en el teléfono, pide volver al punto de venta. El resultado llega también por el webhook firmado de Didit (`/api/kyc/didit`) y se compara con el representante (`lib/kyc.ts`):
   - **Rechazado** si la cédula es de otra persona, si no pasa la prueba de vida, si Didit lo rechaza o si el nombre no coincide. Una cédula distinta nunca se aprueba a mano.
   - **En revisión** (la decide Riesgo en el detalle del comercio) si el nombre coincide solo en parte, la selfie se parece menos que el mínimo configurado, la cédula está vencida o falta algún dato.
   - **Aprobado** si todo está en verde.
   - Hay un máximo configurable de intentos rechazados; después solo el backoffice habilita otro. Si Disglobal cambia el representante legal, se pide un KYC nuevo.
   - Sin KYC aprobado, `solicitar` responde 403.
4. **Oferta** → `GET /api/pos/estado`: monto máximo, plazos disponibles y, para el monto que elija, cargo, total, % de retención y cuota diaria estimada, con el equivalente en Bs a la tasa de hoy.
5. **Solicitar** → `POST /api/pos/solicitar { montoUsd, plazoDias, acepto }`: el servidor vuelve a cotizar con la versión de parámetros de la evaluación. Si el monto y el score están dentro de la aprobación automática, queda aprobado; si no, va a Riesgo.
6. **Seguimiento**: saldo en USD (y en Bs a la tasa de hoy), avance y cada abono diario con su tasa BCV.

### Scoring (`lib/scoring.ts`)

Con los últimos N meses de ventas del POS (6 por defecto), cada día convertido a USD con su tasa BCV:

| Métrica | Subscore (0–100) |
|---|---|
| Ventas mensuales promedio | Volumen, escala logarítmica entre el mínimo y el valor de referencia |
| Variación mes a mes (coeficiente de variación) | Estabilidad |
| Últimos 3 meses vs. anteriores | Tendencia |
| % de días con ventas | Actividad |
| Meses afiliado a Disglobal | Antigüedad |
| % de transacciones rechazadas | Rechazos |

Score = suma ponderada (pesos configurables, suman 100). **Cortes** que dejan sin oferta: estatus distinto de activo en Disglobal, historia mínima, ventas mínimas, días activos mínimos, rechazo máximo y score mínimo.

**Oferta máxima** = el menor entre
- ventas mensuales × % de tope × multiplicador del escalón de score,
- capacidad de pago: lo que se cubre reteniendo el % máximo de las ventas diarias en el plazo más largo,
- el máximo del producto (USD 5.000),

redondeado hacia abajo al múltiplo configurado. Si queda por debajo del mínimo (USD 200), no hay oferta.

**Capacidad según flujo y pagos.** Los ingresos que cuentan son los de los últimos 3 meses (configurable); la tendencia los compara con los 3 anteriores. Si el comercio ya tomó un adelanto, se mide cómo pagó el último (`comportamientoPago`): frecuencia = días con abono / días transcurridos; ritmo = % pagado / % del plazo transcurrido; atraso = días pagando después del vencimiento. Con eso queda como **bueno** (el cupo sube, ×1,25 por defecto), **regular**, **lento** (baja, ×0,6) o **moroso** (más de 15 días de atraso: sin oferta). Al terminar de pagar se recalcula la oferta. Todos los umbrales están en Parámetros.

### Precio y cobro (`lib/mca.ts`)

- Total a pagar = monto × (1 + costo mensual × plazo/30 + comisión de apertura). Valores iniciales: 7% mensual (el del adelanto de capital de develop.grupoinvesta.com) + 2% de apertura; plazos de 30, 60 y 90 días.
- Retención diaria = total ÷ (plazo × ventas diarias promedio), en pasos de 0,5%, entre el mínimo y el máximo configurados. Un plazo que necesite más que el máximo no se ofrece.
- **Desembolso** (Operaciones): monto USD × tasa BCV del día, transferido a la cuenta de liquidación del comercio en Disglobal. Sin tasa registrada para el día no se puede desembolsar.
- **Cierre diario** (al arrancar, y con el botón en Adelantos): para cada día ya cerrado toma las ventas del POS, retiene el % en Bs y abona en USD a la tasa BCV de ese día (si no se publicó, rige la última). El último abono no pasa del saldo. Pasado el plazo más los días de gracia con saldo, el adelanto queda **vencido**.
- **Pago manual**: para pagos fuera de la retención; se abona a la tasa BCV de la fecha del pago.

### Agentes de IA (`server/agentes.ts`)

| Agente | Qué hace | Cuándo |
|---|---|---|
| Análisis de solicitudes | Jev decide (aprobar / rechazar / revisar con probabilidades, prob. de pagar en plazo, nivel de riesgo) y Claude explica con riesgos y mitigantes. Si coinciden, esa es la recomendación; si no, "revisar". | Al llegar una solicitud a revisión |
| KYC dudosos | Lo mismo para los KYC en revisión (nombre parcial, selfie baja). Una cédula distinta nunca se aprueba. | Al quedar un KYC en revisión |
| Cobro voluntario | Disglobal retiene la cuota antes de liquidar las ventas. Si un día el comercio no vende por el POS, no hay qué retener: el agente le deja un aviso en la app con la cuota sugerida en USD y Bs y los datos de Pago Móvil. El comercio reporta el pago y Operaciones lo concilia (se abona a la tasa BCV de la fecha del pago). | Cierre diario |
| Seguimiento | Avisos a comercios estancados (oferta sin KYC, KYC sin solicitud, adelanto pagado con cupo para renovar). | Cierre diario |
| Resumen diario | Cartera, mora, pendientes, embudo y uso, con acciones para hoy; refresca el proyecto de Hex. | Cierre diario |

Por defecto los agentes **solo recomiendan**; en Parámetros se activa la aprobación automática (cuando Claude y Jev coinciden en aprobar, con confianza mínima y tope de monto). Un rechazo siempre lo decide una persona. Sin credenciales, en demo cada motor se simula con reglas sobre los mismos datos y queda marcado como "simulado". Corren al arrancar y con "Correr agentes ahora" en Backoffice → Agentes IA.

### Backoffice (`/admin`)

| Pantalla | Qué hace |
|---|---|
| Panel | Cartera vigente, vencido, desembolsado y cobrado; pendientes y avance de cobranza |
| Adelantos | Aprobar / rechazar (Riesgo), desembolsar y pagos manuales (Operaciones), correr el cierre diario |
| Comercios | KYC del representante (chequeos, aprobar o rechazar los que quedan en revisión, habilitar otro intento), ficha de Disglobal, correcciones pedidas, terminales, scoring con su desglose, ventas por mes, adelantos y abonos diarios; recalcular scoring, bloquear |
| Seguimiento | Embudo de registro (consultó RIF → sin oferta / falta KYC / KYC en revisión / listo / solicitud / pagando / ya pagó), frecuencia de uso de la app en 30 días, y segmentación por actividad y por geografía (estado y ciudad) con conversión, desembolsado y cartera |
| Agentes IA | Estado de Claude, Jev y Hex; recomendaciones; avisos de cobro voluntario con conciliación; avisos de seguimiento; resumen del día |
| Tasas BCV | Registrar la tasa del día o importar el histórico (`fecha;tasa`) |
| Parámetros | Todos los parámetros de oferta, precio, scoring y aprobación; tabla de ejemplo de ofertas; propuesta → aprobación por otro Administrador; historial de versiones |
| Bitácora | Cada decisión del sistema, del comercio y del backoffice |

Roles: **Administrador** (todo), **Riesgo** (aprobar, rechazar, recalcular, bloquear) y **Operaciones** (desembolsos, pagos, tasas, cierre). Cada servicio valida el permiso en el servidor.

Gobierno de parámetros, igual que en factoring: cada cambio es una versión nueva e inmutable con vigencia desde una fecha; solo Administradores proponen y aprueban; quien propone no aprueba; una propuesta pendiente a la vez; validación de coherencia en el servidor (`validar()` en `lib/params.ts`). Cada evaluación y cada adelanto guardan su versión, así un cambio nunca altera lo ya ofrecido o desembolsado; una evaluación hecha con otra versión se recalcula la próxima vez que el comercio abre la app.

## App Android

Ver [`android/README.md`](android/README.md): contenedor WebView que abre `/pos` y le pasa el serial de la terminal.

## Pendiente

- **API de Disglobal** (`server/disglobal.ts`): ficha por RIF con terminales, ventas diarias por comercio y, para el cobro, que Disglobal retenga el % en la liquidación (o lo informe para cobrarlo por domiciliación).
- **SDK de Newland** en la app Android para leer el serial que Disglobal tiene registrado.
- **Push fuera de la app**: los avisos se ven al abrir la app del POS. Para notificaciones con la app cerrada falta Firebase Cloud Messaging en la app Android.
- **Jev y Hex**: confirmar con TypeSafe y Hex el endpoint y la autenticación (Jev está en acceso anticipado) y crear en Hex el usuario de solo lectura sobre las vistas `hex_*`.
- **Cuenta de cobro**: confirmar con Tesorería los datos de Pago Móvil de `lib/config.ts`.
- **Didit**: crear el workflow, confirmar contra su documentación vigente los campos de la decisión (`normalizarDidit` en `server/kyc.ts`) y el formato de la firma del webhook, y probar en una terminal real (cámara dentro del WebView).
- **Tasa BCV automática** (hoy se registra a mano o se importa, como en factoring).
- Contrato del adelanto y aceptación con firma; notificaciones al comercio (SMS / WhatsApp) al aprobar y desembolsar.
- Validar con Riesgo y Finanzas los valores iniciales de los parámetros.
