import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // pdfkit reads its bundled .afm font files from node_modules at runtime;
  // bundling it breaks those reads, so keep it external (Vercel's file
  // tracing still ships the font data).
  serverExternalPackages: ['pdfkit'],
  // Requests flow through proxy.ts, which buffers the body (10MB cap by default).
  // COI + rate-con + requirements uploads can exceed that, so raise the limit.
  experimental: {
    proxyClientMaxBodySize: '30mb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
