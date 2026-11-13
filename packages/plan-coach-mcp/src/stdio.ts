// plan-coach over stdio: the app server spawns it, and Claude Desktop can too.
// stdout belongs to the protocol, so nothing else may print there.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDefaultServer } from "./factory.ts";

const server = createDefaultServer();
await server.connect(new StdioServerTransport());
console.error("plan-coach ready on stdio");
