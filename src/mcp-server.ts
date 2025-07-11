// MCP Server entry point - runs when MCP_SERVER_MODE=true
// @ts-ignore
const crypto = require("crypto");
// @ts-ignore
const http = require("http");
// @ts-ignore
const readline = require("readline");
// @ts-ignore
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
// @ts-ignore
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
// @ts-ignore
const { z } = require("zod");

interface PermissionRequest {
	id: string;
	tool: string;
	arguments: unknown;
}

interface PermissionResponse {
	requestId: string;
	allowed: boolean;
	message?: string;
	updatedInput?: unknown;
}

// Parse command line arguments
const args = process.argv.slice(2);
let port = 0; // 0 means auto-select port

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--port" && i + 1 < args.length) {
		port = parseInt(args[i + 1]);
	}
}

// Create readline interface for stdin/stdout communication
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false,
});

// Pending permission requests
const pendingRequests = new Map<
	string,
	{
		resolve: (response: unknown) => void;
		reject: (error: unknown) => void;
		timeout: NodeJS.Timeout;
	}
>();

// Handle stdin messages from Obsidian
rl.on("line", (line: string) => {
	if (line.startsWith("PERMISSION_RESPONSE:")) {
		const jsonStr = line.substring("PERMISSION_RESPONSE:".length);
		try {
			const response: PermissionResponse = JSON.parse(jsonStr);
			const pending = pendingRequests.get(response.requestId);

			if (pending) {
				clearTimeout(pending.timeout);
				pending.resolve(response);
				pendingRequests.delete(response.requestId);
			}
		} catch (error) {
			console.error("Failed to parse permission response:", error);
		}
	}
});

// Create MCP server
const server = new McpServer({
	name: "obsidian-permission",
	version: "1.0.0",
});

// Register approval prompt tool (must be named "approval_prompt" for Claude Code SDK)
console.debug("[MCP] Registering approval_prompt tool...");
server.registerTool(
	"approval_prompt",
	{
		title: "Request permission from user",
		description:
			"Request permission from the Obsidian user to perform an action",
		inputSchema: {
			tool_name: z.string().describe("The tool name being requested"),
			input: z.object({}).passthrough().describe("The arguments for the tool"),
		},
	},
	async (params: { tool_name: string; input: unknown }) => {
		const requestId = crypto.randomUUID();
		const request: PermissionRequest = {
			id: requestId,
			tool: params.tool_name,
			arguments: params.input,
		};

		// Send permission request to stdout for Obsidian to detect
		console.debug(`PERMISSION_REQUEST:${JSON.stringify(request)}`);

		// Create a promise that will be resolved when Obsidian responds
		const responsePromise = new Promise<PermissionResponse>(
			(resolve, reject) => {
				// Set timeout (30 seconds)
				const timeout = setTimeout(() => {
					pendingRequests.delete(requestId);
					reject(new Error("Permission request timed out"));
				}, 30000);

				pendingRequests.set(requestId, {
					resolve,
					reject,
					timeout,
				});
			},
		);

		try {
			const response = await responsePromise;

			// Return the expected format for permission prompt tools
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							behavior: response.allowed ? "allow" : "deny",
							message: response.message,
							updatedInput: response.updatedInput || params.input,
						}),
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							behavior: "deny",
							message:
								error instanceof Error ? error.message : "Permission denied",
						}),
					},
				],
			};
		}
	},
);

// Track initialization state
const sessionIdMap = new Map<string, boolean>();

// Create transport that supports multiple sessions
const transport = new StreamableHTTPServerTransport({
	sessionIdGenerator: () => crypto.randomUUID(),
});

// Connect server to transport
server
	.connect(transport)
	.then(() => {
		console.debug("[MCP-HTTP] Server connected to transport");
		console.debug("[MCP-HTTP] Registered tools:", ["approval_prompt"]);

		// Create HTTP server
		const httpServer = http.createServer(async (req: any, res: any) => {
			console.debug(
				`[MCP-HTTP] ${req.method} ${req.url} from ${req.headers["user-agent"]}`,
			);
			console.debug("[MCP-HTTP] Headers:", req.headers);

			// CORS headers for Claude
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
			res.setHeader(
				"Access-Control-Allow-Headers",
				"Content-Type, Authorization",
			);

			// Handle OPTIONS requests
			if (req.method === "OPTIONS") {
				console.debug("[MCP-HTTP] Handling OPTIONS request");
				res.writeHead(200);
				res.end();
				return;
			}

			// Handle MCP requests
			if (req.method === "POST") {
				let body = "";
				req.on("data", (chunk: any) => {
					body += chunk;
					console.debug("[MCP-HTTP] Receiving data chunk, size:", chunk.length);
				});
				req.on("end", async () => {
					console.debug("[MCP-HTTP] Request body:", body);
					try {
						const jsonBody = JSON.parse(body);
						console.debug(
							"[MCP-HTTP] Parsed JSON request:",
							JSON.stringify(jsonBody, null, 2),
						);

						// Extract session ID from headers
						const sessionId =
							(req.headers["mcp-session-id"] as string) || "default";

						// Check if this is a tool invocation request
						if (
							jsonBody.method === "tools/call" &&
							jsonBody.params?.name === "approval_prompt"
						) {
							console.debug("[MCP-HTTP] Approval prompt tool invoked!");
							console.debug(
								"[MCP-HTTP] Tool arguments:",
								jsonBody.params?.arguments,
							);
						}

						// Handle initialize requests specially
						if (jsonBody.method === "initialize") {
							console.debug(
								"[MCP-HTTP] Initialize request received for session:",
								sessionId,
							);

							// Check if this session is already initialized
							if (sessionIdMap.has(sessionId)) {
								console.debug(
									"[MCP-HTTP] Session already initialized, allowing re-initialization",
								);
								// Clear the session to allow re-initialization
								sessionIdMap.delete(sessionId);
							}

							// Mark session as initialized
							sessionIdMap.set(sessionId, true);
						}

						// Handle request and capture response
						const originalWrite = res.write;
						const originalEnd = res.end;
						let responseData = "";

						// Intercept response data
						res.write = (chunk: any, ...args: unknown[]) => {
							if (chunk) {
								responseData += chunk.toString();
							}
							return originalWrite.apply(res, [chunk, ...args]);
						};

						res.end = (chunk: any, ...args: unknown[]) => {
							if (chunk) {
								responseData += chunk.toString();
							}
							console.debug(
								"[MCP-HTTP] Response for",
								jsonBody.method,
								":",
								responseData,
							);

							// Log specific method responses
							if (jsonBody.method === "tools/list") {
								console.debug("[MCP-HTTP] Tools list response sent");
							} else if (jsonBody.method === "initialize") {
								console.debug(
									"[MCP-HTTP] Initialize completed, tools should be available now",
								);
							}

							return originalEnd.apply(res, [chunk, ...args]);
						};

						await transport.handleRequest(req, res, jsonBody);
					} catch (error) {
						console.error("[MCP-HTTP] Error handling request:", error);
						const errorResponse = JSON.stringify({ error: "Invalid request" });
						console.error("[MCP-HTTP] Error response:", errorResponse);
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(errorResponse);
					}
				});
			} else {
				console.log("[MCP-HTTP] Method not allowed:", req.method);
				res.writeHead(404);
				res.end();
			}
		});

		// Start listening
		httpServer.listen(port, "127.0.0.1", () => {
			const actualPort = (httpServer.address() as any).port;
			console.log(
				`[MCP-HTTP] HTTP server started on http://127.0.0.1:${actualPort}`,
			);
			// Send server info to stdout for Obsidian to detect
			console.log(`MCP_SERVER_STARTED:${JSON.stringify({ port: actualPort })}`);
		});

		// Store server reference for cleanup
		httpServerRef = httpServer;
		
		httpServer.on("error", (error: any) => {
			console.error("[MCP-HTTP] HTTP server error:", error);
			console.error(
				`MCP_SERVER_ERROR:${JSON.stringify({ error: error.message })}`,
			);
			process.exit(1);
		});
	})
	.catch((error: any) => {
		console.error("[MCP-HTTP] Failed to connect server to transport:", error);
		process.exit(1);
	});

// Store httpServer reference for cleanup
let httpServerRef: any = null;

// Handle process termination
const gracefulShutdown = () => {
	console.log("[MCP-HTTP] Shutting down gracefully...");
	if (httpServerRef) {
		httpServerRef.close(() => {
			console.log("[MCP-HTTP] HTTP server closed");
			process.exit(0);
		});
		// Force exit after 1 second if server doesn't close
		setTimeout(() => {
			console.log("[MCP-HTTP] Forcing exit...");
			process.exit(0);
		}, 1000);
	} else {
		process.exit(0);
	}
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
