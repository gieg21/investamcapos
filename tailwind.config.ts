import type { Config } from "tailwindcss";

// Tokens tomados del Investa Brand Guidelines (Drive: Investa Material Visual y Brand Book)
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#1955FA", // Blue Ribbon
          50: "#EEF3FF",
          100: "#D8E8FF", // Hawkes Blue
          300: "#8BC0FF", // Jordy Blue
          500: "#1955FA",
          600: "#1347D6",
          900: "#163092", // Cobalt
        },
        ink: "#121212", // Cod Gray
        sand: "#F5F5F5", // Wild Sand
        coral: { DEFAULT: "#F34645", 100: "#FFE1E1", 300: "#FEA4A3" },
        navy: "#0F1729",
      },
      fontFamily: {
        // Brand Guidelines: Space Grotesk (solo Medium) para titulares, Inter para texto
        display: ['"Space Grotesk"', '"Inter"', "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(18,18,18,.04), 0 4px 16px rgba(18,18,18,.06)" },
    },
  },
  plugins: [],
};
export default config;
