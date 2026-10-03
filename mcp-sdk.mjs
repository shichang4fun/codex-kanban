// Build this facade into one runtime file for dependency-free plugin installs.
export {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
export {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
export {registerAppResource,registerAppTool,RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';
export {z} from 'zod';
