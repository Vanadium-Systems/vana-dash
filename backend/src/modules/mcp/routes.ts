import type { FastifyInstance } from 'fastify'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { routeKey } from '../../shared/middleware/feature-guard.js'
import { TOOLS, type ToolDef } from './tools.js'

// MCP endpoint for Claude Code over the person's personal API token. Stateless (protocol
// 2026-07-28, one POST per message; 2025 clients are served by the SDK's stateless fallback).
// Each tool re-enters the app through `app.inject` with the same Authorization header, so the
// token's rights, the guard, the history and the per-token rate limit apply as for a direct call.

const MAX_RESULT_CHARS = 60_000
const MCP_BODY_LIMIT_BYTES = 256 * 1024
const MCP_MESSAGES_PER_MIN = 300

interface CallerInfo {
  authorization: string
  ip: string
  features: Set<string>
}

function toolAllowed(app: FastifyInstance, tool: ToolDef, features: Set<string>): boolean {
  if (!app.featureGuard.routes.has(routeKey(tool.method, tool.route))) return false
  const feature = app.featureGuard.routes.get(routeKey(tool.method, tool.route))
  return !feature || features.has(feature)
}

function buildUrl(tool: ToolDef, input: Record<string, unknown>): string {
  let path = tool.route
  for (const param of tool.pathParams ?? []) path = path.replace(`:${param}`, encodeURIComponent(String(input[param])))
  if (tool.method !== 'GET') return path
  const query = new URLSearchParams()
  const { query: extra, ...rest } = input as { query?: Record<string, unknown> }
  for (const [key, value] of Object.entries({ ...rest, ...extra })) {
    if (key === 'body' || tool.pathParams?.includes(key) || value === undefined || value === null) continue
    query.set(key, String(value))
  }
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

function errorText(statusCode: number, payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { error?: unknown }
    const error = parsed.error as { code?: string; feature?: string } | string | undefined
    if (typeof error === 'object' && error?.code === 'FEATURE_FORBIDDEN') {
      return `HTTP 403: this token lacks the feature "${error.feature}".`
    }
    return `HTTP ${statusCode}: ${typeof error === 'string' ? error : JSON.stringify(error ?? parsed)}`
  } catch {
    return `HTTP ${statusCode}`
  }
}

function serverForCaller(app: FastifyInstance, caller: CallerInfo): McpServer {
  const server = new McpServer({ name: 'vanadash', version: '1.0.0' })
  for (const tool of TOOLS) {
    // tools/list shows only what the token can call, so the model does not spend context on the rest.
    if (!toolAllowed(app, tool, caller.features)) continue
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (input) => {
      const args = input as Record<string, unknown>
      const res = await app.inject({
        method: tool.method,
        url: buildUrl(tool, args),
        headers: { authorization: caller.authorization, 'content-type': 'application/json' },
        // The caller's address, so history and the IP rate limit see the real client, not localhost.
        remoteAddress: caller.ip,
        ...(tool.method === 'GET' ? {} : { payload: JSON.stringify(args.body ?? {}) }),
      })
      if (res.statusCode >= 400) {
        return { isError: true, content: [{ type: 'text' as const, text: errorText(res.statusCode, res.payload) }] }
      }
      let text = res.payload
      try {
        const parsed = JSON.parse(res.payload) as { data?: unknown }
        text = JSON.stringify(parsed.data ?? parsed)
      } catch {
        // Not JSON (a file route): returned as is, cut below.
      }
      if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: narrow the query]`
      return { content: [{ type: 'text' as const, text }] }
    })
  }
  return server
}

export async function mcpRoutes(app: FastifyInstance) {
  const handler = createMcpHandler(
    ({ authInfo }) => {
      const caller = authInfo?.extra as CallerInfo | undefined
      // The route below always passes the caller; without it the server has no tools.
      return serverForCaller(app, caller ?? { authorization: '', ip: '', features: new Set() })
    },
    { responseMode: 'json' },
  )
  app.addHook('onClose', async () => handler.close())

  app.post(
    '/mcp',
    // The routes the tools call are counted on the token; this budget only covers the protocol
    // messages themselves (discover, tools/list), per IP. MCP messages are small JSON.
    {
      preHandler: [app.authenticate],
      bodyLimit: MCP_BODY_LIMIT_BYTES,
      config: { rateLimit: { max: MCP_MESSAGES_PER_MIN, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!req.apiToken) return reply.code(403).send({ success: false, error: 'TOKEN_REQUIRED' })
      // The legitimate client is a CLI. A browser always sends Origin; refusing it keeps a web page
      // from driving the endpoint with a token it got hold of.
      if (req.headers.origin !== undefined) return reply.code(403).send({ success: false, error: 'ORIGIN_NOT_ALLOWED' })

      // No tool emits notifications, so a held-open listen stream would only hold a socket. Clients
      // (Claude Code included) carry on without it.
      const body = req.body as { method?: unknown; id?: unknown } | null
      if (body?.method === 'subscriptions/listen') {
        return reply.code(200).send({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32601, message: 'Method not found' } })
      }

      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(name, value)
      }
      const request = new Request(`http://localhost${req.url}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body ?? null),
      })
      const response = await handler.fetch(request, {
        parsedBody: req.body,
        authInfo: {
          token: req.apiToken.id,
          clientId: req.apiToken.id,
          scopes: req.me.features,
          extra: { authorization: req.headers.authorization ?? '', ip: req.ip, features: new Set(req.me.features) },
        },
      })
      return reply.send(response)
    },
  )
}
