import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;"
  },
  turbopack: {
    root: fileURLToPath(new URL('../../../', import.meta.url))
  }
};

export default nextConfig;
