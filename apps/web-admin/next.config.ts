import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: '.next-prod',
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack(config) {
    return config;
  },
  experimental: {
    typedRoutes: false,
    webpackBuildWorker: false,
    parallelServerCompiles: false,
    parallelServerBuildTraces: false,
    workerThreads: false,
  },
};

export default nextConfig;
