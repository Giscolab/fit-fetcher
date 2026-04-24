import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// TanStack Start on Vercel uses the Nitro Vite plugin:
// https://vercel.com/docs/frameworks/full-stack/tanstack-start
//
// Plugin order matters: tanstackStart() must come before nitro().
// Tailwind runs after React so utility generation sees the final module graph.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.FIRECRAWL_API_KEY && !process.env.FIRECRAWL_API_KEY) {
    process.env.FIRECRAWL_API_KEY = env.FIRECRAWL_API_KEY;
  }

  return {
    plugins: [
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart(),
      nitro(),
      viteReact(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": `${process.cwd()}/src`,
      },
    },
    server: {
      host: "::",
      port: 8080,
    },
  };
});
