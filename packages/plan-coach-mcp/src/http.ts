// plan-coach over Streamable HTTP, for MCP Inspector or any remote host.
// Stateless: a fresh server per request. Listens on localhost only.
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { config } from "./config.ts";
import { createDefaultServer } from "./factory.ts";

const app = new Hono();

app.all("/mcp", async (c) => {
  const server = createDefaultServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    void server.close();
  }
});

serve({ fetch: app.fetch, port: config.httpPort, hostname: "127.0.0.1" }, ({ port }) => {
  console.error(`plan-coach on http://127.0.0.1:${port}/mcp`);
});
