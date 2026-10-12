process.env.DATABASE_URL ??= 'postgres://vanadash:vanadash@localhost:5433/vanadash'
process.env.JWT_SECRET ??= 'test'
process.env.MASTER_ENCRYPTION_KEY ??= 'a'.repeat(64)
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5174'
const { buildServer } = await import('../app.js')
const app = await buildServer()
await app.ready()
console.log(app.printRoutes({ commonPrefix: false }))
await app.close()
process.exit(0)
