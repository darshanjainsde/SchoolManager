/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The console is authenticated and per-user; nothing here is edge-cacheable.
  // The PUBLIC catalogue (a later route group) is the part that gets
  // s-maxage + stale-while-revalidate, per the design spec's caching table.
};
export default nextConfig;
