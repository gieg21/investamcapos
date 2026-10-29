import type { Metadata, Viewport } from "next";
// Tipografía de marca (Investa Brand Guidelines): Space Grotesk Medium para titulares · Inter para texto.
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Investa · Adelanto de capital",
  description: "Adelanto de capital para comercios con punto de venta Disglobal, pagado con un % de las ventas diarias.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#1955FA" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-VE">
      <body>{children}</body>
    </html>
  );
}
