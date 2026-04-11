import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { PhalanxHost } from "../app/host.js";
import type { McpToolResult } from "./server.js";
import { PHALANX_MCP_TOOL_REGISTRY } from "./registry.js";

type ToolContentResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};

export type McpToolRegistrar = {
  registerTool(
    name: string,
    config: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<ToolContentResult>,
  ): unknown;
};

function toToolResult(result: McpToolResult): ToolContentResult {
  if (result.ok) {
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      structuredContent: result.data,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            ok: false,
            code: result.code,
            message: result.message,
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
    structuredContent: {
      ok: false,
      code: result.code,
      message: result.message,
    },
  };
}

export function registerPhalanxMcpTools(server: McpToolRegistrar, host: PhalanxHost): void {
  for (const tool of PHALANX_MCP_TOOL_REGISTRY) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => toToolResult(await host.invokeMcp(tool.name, args)),
    );
  }
}

export function createPhalanxMcpServer(host: PhalanxHost): McpServer {
  const server = new McpServer({
    name: "phalanx-skill",
    version: "0.1.0",
  });
  registerPhalanxMcpTools(server as unknown as McpToolRegistrar, host);
  return server;
}

export async function startPhalanxMcpStdioServer(
  host: PhalanxHost,
  transport = new StdioServerTransport(),
): Promise<{ server: McpServer; transport: StdioServerTransport }> {
  const server = createPhalanxMcpServer(host);
  await server.connect(transport);
  return { server, transport };
}
