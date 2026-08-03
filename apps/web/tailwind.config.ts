import type { Config } from "tailwindcss";
import defaultColors from "tailwindcss/colors";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/features/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        destructive: "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        sidebar: "hsl(var(--sidebar))",
        "sidebar-foreground": "hsl(var(--sidebar-foreground))",
        // Marca OSHER. As chaves de marca sao mescladas na escala padrao do
        // Tailwind para nao invalidar os usos existentes (emerald-500 etc.).
        navy: {
          900: "#0B0F19",
          800: "#0E1420",
          700: "#111827"
        },
        emerald: {
          ...defaultColors.emerald,
          brand: "#0F9D68",
          bright: "#16C989",
          deep: "#0A5D3F"
        },
        ink: {
          100: "#F3F6F5",
          400: "#9AA7A2",
          600: "#5E6B66"
        }
      },
      fontFamily: {
        sans: ["Inter", "Arial", "sans-serif"]
      },
      borderRadius: {
        xl2: "24px"
      },
      boxShadow: {
        executive: "0 18px 45px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
