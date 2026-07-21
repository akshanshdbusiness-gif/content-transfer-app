import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "js", "jsx"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            // The app must stay embeddable in the Sitecore Cloud Portal
            // iframe, but nowhere else (clickjacking hardening).
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://*.sitecorecloud.io https://*.sitecore.io",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
