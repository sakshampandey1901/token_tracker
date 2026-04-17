/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@token-tracker/shared"],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
