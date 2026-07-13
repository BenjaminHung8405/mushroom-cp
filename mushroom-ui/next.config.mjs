/** @type {import('next').NextConfig} */
const nextConfig = {
  // The UI is accessed through the OrbStack HTTPS hostname in local dev.
  // Permit that origin to connect to Next/Turbopack's HMR endpoint.
  allowedDevOrigins: ['mushroom-ui.mushroom-cp.orb.local'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
