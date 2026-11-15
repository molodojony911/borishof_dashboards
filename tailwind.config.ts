import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07080A",
          900: "#0C0E12",
          800: "#12151C",
          700: "#1A1F29",
          600: "#252B38"
        },
        gold: {
          400: "#D4B56A",
          500: "#C4A35A",
          600: "#A8883E"
        },
        paper: "#EDEAE3",
        mute: "#9AA3B2"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"]
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(255,255,255,0.04)"
      }
    }
  },
  plugins: []
};

export default config;
