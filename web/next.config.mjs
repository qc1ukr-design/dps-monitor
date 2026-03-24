/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 14: serverComponentsExternalPackages (moved to top-level in Next.js 15)
  experimental: {
    serverComponentsExternalPackages: ['jkurwa', 'gost89', 'adm-zip', 'node-forge'],
  },
}

export default nextConfig
