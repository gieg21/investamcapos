import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * A donde vuelve Didit al terminar. Si se verificó en el mismo POS (tiene la sesión), vuelve a la app;
 * si se hizo desde el teléfono con el QR, le pide volver al punto de venta, que ya se actualiza solo.
 */
export function GET(req: Request) {
  if (cookies().get("mca_pos")) return NextResponse.redirect(new URL("/pos?kyc=listo", req.url));
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verificación enviada · Investa</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#F5F5F5;color:#121212;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
main{max-width:360px;text-align:center}img{height:28px}h1{font-size:24px;font-weight:500;margin:24px 0 8px}p{color:#6b6b6b;line-height:1.5}</style></head>
<body><main><img src="/brand/investa-color.svg" alt="Investa"><h1>Listo, recibimos tu verificación</h1>
<p>Vuelve al punto de venta: allí verás el resultado en unos segundos. Ya puedes cerrar esta página.</p></main></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
