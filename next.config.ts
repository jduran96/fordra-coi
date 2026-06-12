import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow viewing the dev server from other machines on the LAN
  // (Next 16 blocks cross-origin dev assets by default).
  allowedDevOrigins: ["10.0.0.162"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
