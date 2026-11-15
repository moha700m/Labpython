const isExport = process.env.NODE_ENV === "production";
const apiOrigin = process.env.MCS_API_ORIGIN ?? "http://127.0.0.1:4000";

/** @type {import('next').NextConfig} */
const config = {
  // Production: a static export served by the API on the same origin (cookies + websockets "just work").
  ...(isExport ? { output: "export" } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@mcs/shared", "@mcs/localization"],
  ...(isExport ? {} : { async rewrites() { return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }]; } }),
};
export default config;
