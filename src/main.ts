// Entry point that decides whether to run as Obsidian plugin or MCP server
if (process.env.MCP_SERVER_MODE === "true") {
	// Run as MCP server
	require('./mcp-server');
} else {
	// Run as Obsidian plugin
	module.exports = require('./obsidian-plugin');
}

// Make this file a module
export {};