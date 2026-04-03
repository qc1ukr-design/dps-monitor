import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['jkurwa', 'gost89', 'adm-zip', 'node-forge'],
  turbopack: {
    root: resolve(__dirname, '..'),
  },
}

export default nextConfig
