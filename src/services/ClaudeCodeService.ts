import { type App, TFile } from "obsidian";
import type ClaudeCodePlugin from "../obsidian-plugin";
import {
	type Message,
	ToolUse,
	ToolResult,
	MessageType,
	PermissionRequest,
	PermissionResponse,
} from "../types";
import type { SDKMessage } from "@anthropic-ai/claude-code";

export class ClaudeCodeService {
	private plugin: ClaudeCodePlugin;
	private currentProcess: any = null;

	constructor(plugin: ClaudeCodePlugin) {
		this.plugin = plugin;
	}

	async sendMessage(
		messages: Message[],
		app: App,
		onMessage?: (message: Message) => void,
		onUpdateMessage?: (id: string, update: Partial<Message>) => void,
	): Promise<string> {
		// Cancel any ongoing request
		if (this.currentProcess) {
			this.currentProcess.kill();
			this.currentProcess = null;
		}

		// Ensure MCP server is running
		if (this.plugin.context.permissionServer) {
			if (!this.plugin.context.permissionServer.isServerRunning()) {
				console.debug("[Claude] MCP server not running, starting it...");
				try {
					const port = await this.plugin.context.permissionServer.start();
					console.debug(`[Claude] MCP server started on port ${port}`);

					// Wait a bit for server to be fully ready
					await new Promise((resolve) => setTimeout(resolve, 500));
				} catch (error) {
					console.error("[Claude] Failed to start MCP server:", error);
					// Continue without MCP server
				}
			} else {
				console.debug("[Claude] MCP server is already running");
			}
		}

		// Get the latest message
		const latestMessage = messages[messages.length - 1];

		// Build conversation context - filter out system messages and permission requests
		let conversationContext = "";

		// Add conversation history
		if (messages.length > 1) {
			conversationContext += `=== Previous conversation ===\n`;
			const history = messages.slice(0, -1).filter(
				(msg) =>
					// Only include user and assistant text messages
					(msg.role === "user" || msg.role === "assistant") &&
					msg.type !== "permission_request" &&
					msg.type !== "tool_use" &&
					msg.content.trim() !== "",
			);
			for (const msg of history) {
				conversationContext += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n\n`;
			}
			conversationContext += `=== End of conversation history ===\n\n`;
		}

		// Build the prompt with context
		const prompt = conversationContext + `User: ${latestMessage.content}`;

		return new Promise(async (resolve, reject) => {
			try {
				let fullResponse = "";
				let jsonBuffer = "";
				let errorOutput = "";
				let messageIdCounter = Date.now();
				const toolUseMessageIds = new Map<string, string>(); // tool_use_id -> message_id
				let currentTextMessageId: string | null = null;
				let currentTextContent = "";

				// Use Node.js child_process (available in Electron)
				// @ts-ignore - Electron provides Node.js APIs
				const { spawn } = require("child_process");
				// @ts-ignore - Electron provides Node.js APIs
				const { existsSync } = require("fs");

				// Determine claude command path
				const claudeCommand = this.plugin.settings.claudePath || "claude";

				// Check if the command exists (only for full paths)
				if (
					this.plugin.settings.claudePath &&
					!existsSync(this.plugin.settings.claudePath)
				) {
					reject(
						new Error(
							`Claude Code executable not found at: ${this.plugin.settings.claudePath}`,
						),
					);
					return;
				}

				console.debug(`Executing Claude Code at: ${claudeCommand}`);

				// Get the vault root path
				const vaultPath = (app.vault.adapter as any).basePath || "";
				console.log(`Setting working directory to vault: ${vaultPath}`);

				// Prepare environment with custom PATH
				const customEnv = { ...process.env };
				if (this.plugin.settings.envPath) {
					// Prepend custom paths to existing PATH
					const separator = process.platform === "win32" ? ";" : ":";
					customEnv.PATH =
						this.plugin.settings.envPath + separator + (process.env.PATH || "");
					console.log(`Using custom PATH: ${customEnv.PATH}`);
				}
				console.log(`Current process.cwd() before spawn: ${process.cwd()}`);

				// Build command arguments
				const args = ["--verbose", "--output-format", "stream-json"];

				// Add permission prompt tool if server is available
				if (this.plugin.context.permissionServer) {
					const toolName =
						this.plugin.context.permissionServer.getMcpToolName();
					args.push("--permission-prompt-tool", toolName);
					console.log(`[Claude] Using permission prompt tool: ${toolName}`);
					console.debug(
						"[Claude] MCP server port:",
						this.plugin.context.permissionServer.getPort(),
					);
				}

				// Spawn claude command directly with arguments
				const claudeProcess = spawn(claudeCommand, args, {
					env: customEnv,
					cwd: vaultPath, // Set working directory to vault
					windowsHide: true,
					shell: false, // Don't use shell
				});

				this.currentProcess = claudeProcess;

				console.debug("Claude process started, PID:", claudeProcess.pid);
				console.debug("Command args:", args);
				console.debug("Spawn options cwd:", vaultPath);
				console.debug("Current process.cwd() after spawn:", process.cwd());
				console.debug("Sending prompt:", prompt);

				// Write prompt to stdin
				claudeProcess.stdin.write(prompt);
				claudeProcess.stdin.end();

				// Handle stdout data (streaming JSON)
				claudeProcess.stdout.on("data", (data: Buffer) => {
					const chunk = data.toString();
					jsonBuffer += chunk;

					// Try to parse complete JSON lines
					const lines = jsonBuffer.split("\n");
					jsonBuffer = lines[lines.length - 1]; // Keep incomplete line

					for (let i = 0; i < lines.length - 1; i++) {
						const line = lines[i].trim();
						if (!line) continue;

						try {
							const message: SDKMessage = JSON.parse(line);

							// Debug: log all messages
							console.debug("Claude message:", message);

							// Process message based on type
							if (message.type === "assistant" && "message" in message) {
								console.debug("Processing assistant message:", message);
								const assistantMessage = message.message;
								if (assistantMessage.content) {
									for (const block of assistantMessage.content) {
										if (block.type === "text" && block.text) {
											console.debug("Text block:", block.text);
											fullResponse += block.text;
											currentTextContent += block.text;

											if (onMessage) {
												if (!currentTextMessageId) {
													// Create new text message
													currentTextMessageId =
														(++messageIdCounter).toString();
													const textMessage: Message = {
														id: currentTextMessageId,
														role: "assistant",
														content: currentTextContent,
														timestamp: Date.now(),
														type: "text",
													};
													onMessage(textMessage);
												} else if (onUpdateMessage) {
													// Update existing text message
													onUpdateMessage(currentTextMessageId, {
														content: currentTextContent,
													});
												}
											}
										} else if (block.type === "tool_use") {
											// Reset text accumulation when tool use starts
											currentTextMessageId = null;
											currentTextContent = "";

											// Check if this is an MCP permission tool
											const isMcpTool =
												block.name && block.name.includes("approval_prompt");
											if (isMcpTool) {
												console.log(
													`[Claude] MCP approval tool invoked: ${block.name}`,
												);
												console.debug("[Claude] MCP tool details:", block);
											} else {
												console.debug("Tool use block:", block);
											}

											if (onMessage) {
												const messageId = (++messageIdCounter).toString();
												const toolUseMessage: Message = {
													id: messageId,
													role: "assistant",
													content: "",
													timestamp: Date.now(),
													type: "tool_use",
													toolUse: {
														id: block.id,
														name: block.name,
														input: block.input,
													},
													isToolComplete: false,
												};
												onMessage(toolUseMessage);
												// Store mapping for later update
												toolUseMessageIds.set(block.id, messageId);
											}
										} else {
											console.debug("unknown message:", block);
										}
									}
								}
							} else if (
								message.type === "result" &&
								message.subtype === "success"
							) {
								console.debug("Processing result message:", message);
								// Result contains the final response
								if (!fullResponse && message.result) {
									fullResponse = message.result;
								}
							} else if (message.type === "system") {
								// System messages for debugging
								if (message.subtype === "init" && "mcp_servers" in message) {
									console.log(
										"[Claude] System init message with MCP servers:",
										message.mcp_servers,
									);
									if ("cwd" in message) {
										console.log(
											"[Claude] Claude Code working directory:",
											message.cwd,
										);
									}
									console.debug("[Claude] Full init message:", message);
								} else {
									console.log("[Claude] System message:", message);
								}
							} else if (message.type === "user" && "message" in message) {
								// Handle tool_result messages
								const userMessage = message.message;
								if (userMessage.content) {
									for (const contentItem of userMessage.content) {
										if (
											contentItem.type === "tool_result" &&
											"content" in contentItem
										) {
											console.debug(
												"Tool result content:",
												contentItem.content,
											);

											// Check if this is a permission error
											const content =
												typeof contentItem.content === "string"
													? contentItem.content
													: JSON.stringify(contentItem.content);
											if (
												content.includes("Claude requested permissions") &&
												contentItem.is_error
											) {
												// This is a permission request error - we should not show this as a regular tool result
												// The permission server will handle this
												console.debug(
													"Permission request detected, handled by MCP server",
												);
											} else {
												// Find the corresponding tool_use message and update it
												const messageId = toolUseMessageIds.get(
													contentItem.tool_use_id,
												);
												if (messageId && onUpdateMessage) {
													onUpdateMessage(messageId, {
														toolResult: {
															tool_use_id: contentItem.tool_use_id,
															content: content,
														},
														isToolComplete: true,
													});
												}
											}
										}
									}
								}
							} else {
								console.debug("Unhandled message type:", message);
							}
						} catch (e) {
							// Not a complete JSON object yet, continue
							console.debug("JSON parse error (expected for partial data):", e);
						}
					}
				});

				// Handle stderr (errors)
				claudeProcess.stderr.on("data", (data: Buffer) => {
					const stderr = data.toString();
					errorOutput += stderr;
					console.error("Claude stderr:", stderr);

					// Log specific error details
					if (stderr.includes("MCP tool") && stderr.includes("not found")) {
						console.error("[Claude] MCP tool not found error detected");
						console.error(
							"[Claude] Available MCP tools in error message:",
							stderr.match(/Available MCP tools: (.+)/)?.[1],
						);
					}
				});

				// Handle process exit
				claudeProcess.on("close", (code: number) => {
					this.currentProcess = null;
					console.debug("Claude process exited with code:", code);
					console.debug("Final response:", fullResponse);

					// Kill MCP server process for clean restart next time
					console.debug(
						"[Claude] Checking permission server:",
						this.plugin.context.permissionServer,
					);
					if (this.plugin.context.permissionServer) {
						console.debug(
							"[Claude] Permission server exists, getting MCP PID...",
						);
						const mcpPid =
							this.plugin.context.permissionServer.getMcpProcessPid();
						console.debug("[Claude] MCP PID:", mcpPid);
						if (mcpPid) {
							console.log(
								"[Claude] Killing MCP server process (PID:",
								mcpPid,
								") for clean restart next time",
							);
							try {
								process.kill(mcpPid, "SIGKILL");
								console.log("[Claude] SIGKILL sent to MCP server");
							} catch (error) {
								console.error("[Claude] Failed to kill MCP server:", error);
							}
						} else {
							console.debug("[Claude] No MCP PID available");
						}
					} else {
						console.debug("[Claude] No permission server available");
					}

					if (code === 0) {
						if (fullResponse) {
							resolve(fullResponse);
						} else {
							reject(new Error("No response received from Claude"));
						}
					} else {
						// Check error output for specific issues
						if (
							errorOutput.includes("ENOENT") ||
							errorOutput.includes("command not found") ||
							errorOutput.includes("not found")
						) {
							const pathInfo = this.plugin.settings.claudePath
								? `at path: ${this.plugin.settings.claudePath}`
								: "in PATH";
							reject(
								new Error(
									`Claude Code not found ${pathInfo}. Please check the path in settings or install using: npm install -g @anthropic-ai/claude-code`,
								),
							);
						} else if (
							errorOutput.includes("EACCES") ||
							errorOutput.includes("Permission denied")
						) {
							reject(
								new Error(
									`Permission denied executing Claude Code at: ${claudeCommand}. Please check file permissions.`,
								),
							);
						} else {
							reject(
								new Error(
									`Claude process exited with code ${code}. Error: ${errorOutput}`,
								),
							);
						}
					}
				});

				// Handle process error (e.g., command not found)
				claudeProcess.on("error", (error: any) => {
					this.currentProcess = null;
					console.error("Failed to start Claude process:", error);

					if (error.code === "ENOENT") {
						const pathInfo = this.plugin.settings.claudePath
							? `at path: ${this.plugin.settings.claudePath}`
							: "in PATH";
						reject(
							new Error(
								`Claude Code executable not found ${pathInfo}. Please check the path in settings.`,
							),
						);
					} else if (error.code === "EACCES") {
						reject(
							new Error(
								`Permission denied executing Claude Code at: ${claudeCommand}`,
							),
						);
					} else {
						reject(new Error(`Failed to start Claude: ${error.message}`));
					}
				});
			} catch (error) {
				console.error("Error in sendMessage:", error);
				reject(
					new Error(
						"Failed to communicate with Claude: " +
							(error instanceof Error ? error.message : "Unknown error"),
					),
				);
			}
		});
	}

	cancelRequest() {
		if (this.currentProcess) {
			this.currentProcess.kill();
			this.currentProcess = null;
		}
	}

	restartProcess() {
		// Kill existing process if any
		if (this.currentProcess) {
			console.log("Killing existing Claude Code process...");
			this.currentProcess.kill("SIGTERM");
			this.currentProcess = null;
		}

		// The process will be restarted automatically when next message is sent
		console.log("Claude Code process will be restarted on next message");
	}

	private async extractFileContext(
		content: string,
		app: App,
	): Promise<string | null> {
		// Extract [[file]] references from Obsidian
		const fileReferences = content.match(/\[\[([^\]]+)\]\]/g);
		if (!fileReferences) return null;

		const contexts: string[] = [];
		const processedFiles = new Set<string>();

		for (const ref of fileReferences) {
			const fileName = ref.slice(2, -2); // Remove [[ and ]]

			// Skip if already processed
			if (processedFiles.has(fileName)) continue;
			processedFiles.add(fileName);

			const file = app.metadataCache.getFirstLinkpathDest(fileName, "");

			if (file instanceof TFile) {
				try {
					const fileContent = await app.vault.read(file);
					// Format file content for better context
					contexts.push(
						`\n--- File: ${file.path} ---\n${fileContent}\n--- End of ${file.path} ---`,
					);
				} catch (error) {
					console.error(`Failed to read file ${file.path}:`, error);
				}
			}
		}

		return contexts.length > 0 ? contexts.join("\n") : null;
	}

	async searchVault(query: string, app: App): Promise<TFile[]> {
		const files = app.vault.getMarkdownFiles();
		const results: TFile[] = [];
		const lowerQuery = query.toLowerCase();

		for (const file of files) {
			// Search in file name
			if (file.basename.toLowerCase().includes(lowerQuery)) {
				results.push(file);
				continue;
			}

			// Search in file content (with caching for performance)
			try {
				const content = await app.vault.cachedRead(file);
				if (content.toLowerCase().includes(lowerQuery)) {
					results.push(file);
				}
			} catch (error) {
				console.error(`Failed to search in file ${file.path}:`, error);
			}

			// Limit results for performance
			if (results.length >= 10) break;
		}

		return results;
	}
}
