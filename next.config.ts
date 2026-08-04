import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev-tools badge sits over the sidebar's sign-out control.
  // Hiding it keeps the workspace legible while the app is being reviewed.
  devIndicators: false,
};

export default nextConfig;
