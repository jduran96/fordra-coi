import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Requests flow through proxy.ts, which buffers the body (10MB cap by default).
  // COI + rate-con + requirements uploads can exceed that, so raise the limit.
  experimental: {
    proxyClientMaxBodySize: '30mb',
  },
};

export default nextConfig;
