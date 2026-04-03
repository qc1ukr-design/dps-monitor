import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'

import router from './routes/index.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)

// M-4: trust Railway's reverse proxy so rate limiters see the real client IP
// from X-Forwarded-For rather than the proxy's internal IP
app.set('trust proxy', 1)

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet())

// ---------------------------------------------------------------------------
// CORS — only /web origin in production
// ---------------------------------------------------------------------------
// FRONTEND_URL — production Vercel URL (e.g. https://dps-monitor.vercel.app)
// Comma-separated list is supported for multiple origins.
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
  : ['http://localhost:3000']

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server calls (no Origin header) and listed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`))
      }
    },
    methods: ['GET', 'POST', 'DELETE'],
    // P3.3: X-User-Id removed — no active route reads this header, and its presence
    // in allowedHeaders could mislead future developers into trusting a caller-supplied userId.
    allowedHeaders: ['Content-Type', 'X-Backend-Secret', 'Authorization'],
  })
)

// ---------------------------------------------------------------------------
// Rate limiting — global baseline (tightened per-route where needed)
// ---------------------------------------------------------------------------
// P4.1: Lowered from 100 to 30 req/min/IP. This backend is exclusively server-to-server
// (Vercel → Railway), so 30/min is well above legitimate traffic while limiting cost
// amplification if BACKEND_API_SECRET is ever compromised.
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  })
)

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '2mb' }))

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/', router)

// ---------------------------------------------------------------------------
// Global error handler — must be last
// ---------------------------------------------------------------------------
app.use(errorHandler)

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[backend] DPS-Monitor backend listening on port ${PORT}`)
})

export default app
