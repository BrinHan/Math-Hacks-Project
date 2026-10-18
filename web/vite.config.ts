import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo>/, so the deploy workflow sets BASE_PATH. Local dev and
// root-hosted builds (Netlify, Vercel) use "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
});
