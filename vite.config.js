import { defineConfig } from 'vite';

// Link previews need absolute URLs. SITE_URL wins if set; on Vercel,
// VERCEL_PROJECT_PRODUCTION_URL holds the production domain (a custom one if
// configured). Anywhere else the tags fall back to root-relative paths.
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const siteUrl = (process.env.SITE_URL ?? (productionHost ? `https://${productionHost}` : '')).replace(/\/$/, '');

export default defineConfig({
  plugins: [
    {
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteUrl),
    },
  ],
});
