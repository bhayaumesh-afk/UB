import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f7ff",
          100: "#e0eefe",
          500: "#2f7bf5",
          600: "#1f63d8",
          700: "#1a4fb0",
        },
      },
    },
  },
  plugins: [],
};
export default config;
