import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "/index.html",
    }),
    alias: {
      "@": "./src",
      "@termcast/shared": "../shared/src/index.ts",
      "@termcast/host": "../host/src/index.ts",
    },
  },
};

export default config;
