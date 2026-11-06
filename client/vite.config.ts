import { defineConfig } from 'vite';

const PRODUCTION_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "worker-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*",
  "media-src 'none'",
  "worker-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

export default defineConfig({
  plugins: [
    {
      name: 'html-csp-injector',
      transformIndexHtml(html, ctx) {
        // Only inject production meta CSP tag into final production build output
        if (!ctx.server) {
          return html.replace(
            '<!-- CSP_META_PLACEHOLDER -->',
            `<meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`
          );
        }
        // During dev, omit the meta tag so server headers govern HMR connections
        return html.replace('<!-- CSP_META_PLACEHOLDER -->', '');
      }
    }
  ],
  server: {
    headers: {
      'Content-Security-Policy': DEVELOPMENT_CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    }
  },
  preview: {
    headers: {
      'Content-Security-Policy': PRODUCTION_CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    }
  }
});
