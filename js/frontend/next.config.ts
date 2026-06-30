import type { NextConfig } from "next";

const allowedDevOrigins = [
  process.env.PUBLIC_HOST,
  process.env.FRONTEND_HOST,
].filter((origin): origin is string => Boolean(origin));

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins,
};

export default nextConfig;
