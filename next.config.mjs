/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Servidor Node: el portal y el backoffice consumen la API de app/api (ya no es un sitio estático).
  images: { unoptimized: true },
  experimental: {
    // Postgres embebido (WASM) y el driver de Postgres se cargan desde node_modules, sin empaquetar.
    serverComponentsExternalPackages: ["@electric-sql/pglite", "pg"],
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false; // pdfjs-dist intenta resolver 'canvas' (solo Node)
    return config;
  },
};
export default nextConfig;
