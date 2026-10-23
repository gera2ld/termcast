import adapter from "@sveltejs/adapter-bun";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    Icons({ compiler: "svelte" }),
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter(),
    }),
  ],
  server: {
    proxy: {
      "/rpc": {
        target: "http://localhost:9998",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:9998",
        ws: true,
        changeOrigin: true,
      },
      "/realtime": {
        target: "http://localhost:9998",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
