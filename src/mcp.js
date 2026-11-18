import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { commands } from './engine.js';

export async function serveMcp(store) {
  const mcp = new McpServer({ name: 'kancha-pm', version: '1.0.0' });
  for (const op of Object.values(commands(store))) {
    mcp.registerTool(
      op.name,
      { description: op.description, inputSchema: op.schema.shape },
      async (input) => {
        try {
          const output = await op.fn(op.schema.parse(input));
          return { content: [{ type: 'text', text: JSON.stringify(output) }] };
        } catch (e) {
          return {
            isError: true,
            content: [{ type: 'text', text: e.issues?.[0]?.message || e.message }],
          };
        }
      },
    );
  }
  await mcp.connect(new StdioServerTransport());
}
