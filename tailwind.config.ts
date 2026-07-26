import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0E14",
        surface: "#131722",
        surfaceRaised: "#1A1F2E",
        border: "#232838",
        text: "#E6E8EE",
        muted: "#7B8394",
        accent: "#4FD1A5",
        warn: "#E8B339",
        danger: "#E5484D",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
