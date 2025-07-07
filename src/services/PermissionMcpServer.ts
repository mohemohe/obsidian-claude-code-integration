import type { PermissionRequest, PermissionResponse } from "../types";
import type ClaudeCodePlugin from "../obsidian-plugin";
import { type FileSystemAdapter, Notice, Platform } from "obsidian";

export interface PermissionCallback {
	onPermissionRequest: (request: PermissionRequest) => void;
}

export class PermissionMcpServer {
	private plugin: ClaudeCodePlugin;
	private mcpProcess: any = null;
	private port: number;
	private isRunning = false;
	private callback: PermissionCallback | null = null;
	private pendingRequests = new Map<string, PermissionRequest>();
	private pidFilePath: string = "";

	constructor(plugin: ClaudeCodePlugin) {
		this.plugin = plugin;
		this.port = plugin.settings.mcpServerPort;
		this.pidFilePath = this.getPidFilePath();
	}

	setCallback(callback: PermissionCallback) {
		this.callback = callback;
	}

	async start(): Promise<number> {
    if (!Platform.isDesktopApp) {
      new Notice("Permission MCP server is only available on desktop");
      return -1;
    }

		if (this.isRunning) {
			return this.port;
		}

		// Check for existing PID file and clean up if necessary
		await this.checkAndCleanExistingProcess();

		return new Promise((resolve, reject) => {
			try {
				// @ts-ignore - Electron provides Node.js APIs
				const { spawn } = require("child_process");
				// @ts-ignore - Electron provides Node.js APIs
				const { join } = require("path");

				// Get the plugin directory
				const pluginDir = (this.plugin.app.vault.adapter as FileSystemAdapter).getBasePath()  || "";
				const mcpServerPath = join(
					pluginDir,
					this.plugin.app.vault.configDir,
					"plugins/claude-code-integration/main.js",
				);

				console.debug("[MCP] Starting MCP permission server");
				console.debug("[MCP] Server script path:", mcpServerPath);
				console.debug("[MCP] Plugin directory:", pluginDir);

				// Prepare environment with custom PATH if needed
				const customEnv = { ...process.env };
				// Set MCP server mode environment variable
				customEnv.MCP_SERVER_MODE = "true";

				if (this.plugin.settings.envPath) {
					const separator = process.platform === "win32" ? ";" : ":";
					customEnv.PATH =
						this.plugin.settings.envPath + separator + (process.env.PATH || "");
					console.debug("[MCP] Custom PATH set:", customEnv.PATH);
				}

				// Determine node command
				let nodeCommand = "node";
				if (this.plugin.settings.envPath) {
					// Use node from the specified envPath
					const { existsSync } = require("fs");
					const separator = process.platform === "win32" ? ";" : ":";
					const paths = this.plugin.settings.envPath.split(separator);

					console.debug("[MCP] Searching for node in custom paths:", paths);

					for (const path of paths) {
						const nodePath = join(path, "node");
						const nodeExePath = join(path, "node.exe");

						if (existsSync(nodePath)) {
							nodeCommand = nodePath;
							console.debug("[MCP] Found node at:", nodePath);
							break;
						} else if (existsSync(nodeExePath)) {
							nodeCommand = nodeExePath;
							console.debug("[MCP] Found node.exe at:", nodeExePath);
							break;
						}
					}
				}

				console.debug("[MCP] Using node command:", nodeCommand);
				console.debug(
					"[MCP] Spawning MCP server with command:",
					`${nodeCommand} ${mcpServerPath} --port ${this.port}`,
				);

				// Spawn MCP server with specified port
				this.mcpProcess = spawn(
					nodeCommand,
					[mcpServerPath, "--port", this.port.toString()],
					{
						env: customEnv,
						cwd: pluginDir,
						windowsHide: true,
						shell: false,
						detached: false, // Ensure process is attached to parent
					},
				);

				// Handle stdout data
				this.mcpProcess.stdout.on("data", (data: Buffer) => {
					const chunk = data.toString();
					console.debug("MCP stdout:", chunk);

					// Look for lines in stdout
					const lines = chunk.split("\n");
					for (const line of lines) {
						const trimmedLine = line.trim();
						if (!trimmedLine) continue;

						// Server started message
						if (trimmedLine.startsWith("MCP_SERVER_STARTED:")) {
							const jsonStr = trimmedLine.substring(
								"MCP_SERVER_STARTED:".length,
							);
							try {
								const info = JSON.parse(jsonStr);
								this.port = info.port;
								this.isRunning = true;
								console.debug(
									`[MCP] Permission server started on port ${this.port}`,
								);
								console.debug("[MCP] Server info received:", info);

								// Write PID file
								this.writePidFile();

								// Clean up old servers and register if needed
								console.debug("[MCP] Starting server initialization...");
								this.initializeServer()
									.then(() => {
										console.debug("[MCP] Server initialization completed");
										resolve(this.port);
									})
									.catch((error) => {
										console.error("[MCP] Failed to initialize server:", error);
										// Still resolve with port even if registration fails
										resolve(this.port);
									});
							} catch (error) {
								console.error("Failed to parse server start info:", error);
							}
						}

						// Permission request message
						else if (trimmedLine.startsWith("PERMISSION_REQUEST:")) {
							const jsonStr = trimmedLine.substring(
								"PERMISSION_REQUEST:".length,
							);
							console.debug("[MCP] Received permission request:", trimmedLine);
							try {
								const request: PermissionRequest = JSON.parse(jsonStr);
								request.timestamp = Date.now();
								this.pendingRequests.set(request.id, request);
								console.debug("[MCP] Parsed permission request:", request);
								console.debug(
									"[MCP] Total pending requests:",
									this.pendingRequests.size,
								);

								// Notify callback
								if (this.callback) {
									console.debug(
										"[MCP] Notifying callback about permission request",
									);
									this.callback.onPermissionRequest(request);
								} else {
									console.warn(
										"[MCP] No callback registered for permission request!",
									);
								}
							} catch (error) {
								console.error(
									"[MCP] Failed to parse permission request:",
									error,
								);
								console.error("[MCP] Raw JSON string:", jsonStr);
							}
						}

						// Server error message
						else if (trimmedLine.startsWith("MCP_SERVER_ERROR:")) {
							const jsonStr = trimmedLine.substring("MCP_SERVER_ERROR:".length);
							try {
								const errorInfo = JSON.parse(jsonStr);
								reject(new Error(errorInfo.error));
							} catch (error) {
								console.error("Failed to parse server error:", error);
								reject(new Error("MCP server error"));
							}
						}
					}
				});

				// Handle stderr
				this.mcpProcess.stderr.on("data", (data: Buffer) => {
					const stderr = data.toString();
					console.error("MCP stderr:", stderr);

					// Check for EADDRINUSE error in stderr
					if (stderr.includes("EADDRINUSE")) {
						this.isRunning = false;
						if (this.mcpProcess) {
							this.mcpProcess.kill();
							this.mcpProcess = null;
						}
						reject(
							new Error(
								`Port ${this.port} is already in use. Please stop any existing MCP servers or change the port in settings.`,
							),
						);
					}
				});

				// Handle process exit
				this.mcpProcess.on("close", (code: number) => {
					console.debug("MCP process exited with code:", code);

					// Only reset state if not already running (i.e., unexpected exit)
					if (this.isRunning) {
						this.isRunning = false;
						this.port = this.plugin.settings.mcpServerPort; // Keep configured port
						this.removePidFile();
						reject(
							new Error(`MCP process exited unexpectedly with code ${code}`),
						);
					}
				});

				// Handle process error
				this.mcpProcess.on("error", (error: any) => {
					this.isRunning = false;
					console.error("[MCP] Failed to start MCP process:", error);

					if (
						error.code === "EADDRINUSE" ||
						error.message.includes("EADDRINUSE")
					) {
						reject(
							new Error(
								`Port ${this.port} is already in use. Please stop any existing MCP servers or change the port in settings.`,
							),
						);
					} else {
						reject(new Error(`Failed to start MCP server: ${error.message}`));
					}
				});
			} catch (error) {
				console.error("Error starting MCP server:", error);
				reject(error);
			}
		});
	}

	async stop() {
		if (!this.isRunning || !this.mcpProcess) {
			console.debug("[MCP] No running process to stop");
			return;
		}

		const pid = this.mcpProcess.pid;
		console.debug(`[MCP] Force killing MCP permission server (PID: ${pid})...`);

		// Clean up state immediately
		this.mcpProcess = null;
		this.isRunning = false;
		this.pendingRequests.clear();
		// Keep the configured port
		this.port = this.plugin.settings.mcpServerPort;

		// Try to kill the process
		try {
			process.kill(pid, "SIGKILL");
			console.debug(`[MCP] SIGKILL sent to process ${pid}`);

			// Give it a moment to die
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Check if process is still running
			if (this.isProcessRunning(pid)) {
				console.error(`[MCP] Process ${pid} still running after SIGKILL`);
			} else {
				console.debug(`[MCP] Process ${pid} successfully killed`);
			}
		} catch (error) {
			console.error(`[MCP] Failed to kill process ${pid}:`, error);
		} finally {
			// Always remove PID file
			this.removePidFile();
		}
	}

	async respondToPermission(response: PermissionResponse) {
		if (!this.mcpProcess || !this.isRunning) {
			throw new Error("MCP server is not running");
		}

		const request = this.pendingRequests.get(response.requestId);
		if (!request) {
			throw new Error("Permission request not found");
		}

		console.debug("[MCP] Sending permission response:", response);
		console.debug("[MCP] Original request was:", request);

		// Send response to stdin
		const message = `PERMISSION_RESPONSE:${JSON.stringify(response)}\n`;
		console.debug("[MCP] Writing to MCP server stdin:", message.trim());
		this.mcpProcess.stdin.write(message);

		// Remove from pending
		this.pendingRequests.delete(response.requestId);
		console.debug(
			"[MCP] Removed request from pending, remaining:",
			this.pendingRequests.size,
		);
	}

	getPort(): number {
		return this.port || this.plugin.settings.mcpServerPort;
	}

	getServerName(): string {
		return `obsidian-permission-${this.getPort()}`;
	}

	getMcpToolName(): string {
		return `mcp__${this.getServerName()}__approval_prompt`;
	}

	getPendingRequests(): PermissionRequest[] {
		return Array.from(this.pendingRequests.values());
	}

	getMcpProcessPid(): number | undefined {
		return this.mcpProcess?.pid;
	}

	isServerRunning(): boolean {
		return this.isRunning && this.mcpProcess !== null && this.port > 0;
	}

	private getVaultPath(): string {
    if (!Platform.isDesktopApp) {
      return "";
    }

		return (this.plugin.app.vault.adapter as FileSystemAdapter).getBasePath()  || "";
	}

	private getPidFilePath(): string {
		const { join } = require("path");
		const pluginDir = this.getVaultPath();
		return join(pluginDir, this.plugin.app.vault.configDir, "plugins/claude-code-integration/.mcp-pid");
	}

	private async initializeServer(): Promise<void> {
		const currentServerName = this.getServerName();

		console.debug("[MCP] Initializing server registration...");

		// Get list of all registered servers
		const registeredServers = await this.getRegisteredServers();

		// Clean up old servers (both with and without port suffix)
		const oldServers = registeredServers.filter(
			(name) =>
				name.startsWith("obsidian-permission") && name !== currentServerName,
		);

		if (oldServers.length > 0) {
			console.debug(
				`[MCP] Found ${oldServers.length} old servers to clean up:`,
				oldServers,
			);
			for (const oldServer of oldServers) {
				await this.removeServer(oldServer);
			}
		}

		// Check if current server is already registered
		if (registeredServers.includes(currentServerName)) {
			console.debug(
				"[MCP] Current server is already registered, no action needed",
			);
			return;
		}

		// Register the current server
		console.debug("[MCP] Registering new server...");
		await this.registerWithClaude();

		// Verify registration
		console.debug("[MCP] Verifying server registration...");
		const updatedServers = await this.getRegisteredServers();
		if (updatedServers.includes(currentServerName)) {
			console.debug(
				`[MCP] Server ${currentServerName} successfully verified in registry`,
			);
		} else {
			console.error(
				`[MCP] Server ${currentServerName} not found in registry after registration!`,
			);
		}
	}

	private async getRegisteredServers(): Promise<string[]> {
    if (!Platform.isDesktopApp) {
      return [];
    }

		const { spawn } = require("child_process");

		const vaultPath = this.getVaultPath();
		console.debug("[MCP] Getting registered servers with cwd:", vaultPath);

		return new Promise((resolve) => {
			const listProcess = spawn("claude", ["mcp", "list"], {
				env: this.getClaudeEnvironment(),
				cwd: vaultPath,
				windowsHide: true,
				shell: false,
			});

			let stdout = "";

			listProcess.stdout.on("data", (data: Buffer) => {
				stdout += data.toString();
			});

			listProcess.on("close", (code: number) => {
				if (code === 0) {
					// Parse server names from output
					const lines = stdout.split("\n");
					const servers: string[] = [];
					for (const line of lines) {
						const trimmed = line.trim();
						if (
							trimmed &&
							!trimmed.startsWith("Name") &&
							!trimmed.startsWith("─")
						) {
							// Extract server name (first column)
							const parts = trimmed.split(/\s+/);
							if (parts.length > 0) {
								// Remove trailing colon from server name
								servers.push(parts[0].replace(/:$/, ""));
							}
						}
					}
					console.debug("[MCP] Registered servers:", servers);
					resolve(servers);
				} else {
					console.debug("[MCP] Failed to list servers");
					resolve([]);
				}
			});

			listProcess.on("error", () => {
				resolve([]);
			});
		});
	}

	private async removeServer(serverName: string): Promise<void> {
		const { spawn } = require("child_process");

		return new Promise((resolve) => {
			console.debug(`[MCP] Removing server: ${serverName}`);
			const removeProcess = spawn("claude", ["mcp", "remove", serverName], {
				env: this.getClaudeEnvironment(),
				cwd: this.getVaultPath(),
				windowsHide: true,
				shell: false,
			});

			removeProcess.on("close", (code: number) => {
				if (code === 0) {
					console.debug(`[MCP] Successfully removed server: ${serverName}`);
				} else {
					console.debug(`[MCP] Failed to remove server: ${serverName}`);
				}
				resolve();
			});

			removeProcess.on("error", () => {
				resolve();
			});
		});
	}

	private async registerWithClaude(): Promise<void> {
		const { spawn } = require("child_process");
		const serverName = this.getServerName();
		const serverUrl = `http://localhost:${this.port}`;

		console.debug("[MCP] Starting MCP server registration process");
		console.debug(`[MCP] Server name: ${serverName}, URL: ${serverUrl}`);

		// First, try to remove any existing registration
		await new Promise<void>((resolve) => {
			console.debug(`[MCP] Removing existing registration for ${serverName}`);
			const removeProcess = spawn("claude", ["mcp", "remove", serverName], {
				env: this.getClaudeEnvironment(),
				cwd: this.getVaultPath(),
				windowsHide: true,
				shell: false,
			});

			removeProcess.stdout.on("data", (data: Buffer) => {
				const output = data.toString();
				console.debug("[MCP] Remove stdout:", output.trim());
			});

			removeProcess.stderr.on("data", (data: Buffer) => {
				const output = data.toString();
				console.debug("[MCP] Remove stderr:", output.trim());
			});

			removeProcess.on("close", (code: number) => {
				console.debug(`[MCP] Remove command exited with code ${code}`);
				// Ignore errors from remove command
				resolve();
			});

			removeProcess.on("error", (error: any) => {
				console.debug("[MCP] Remove command error:", error.message);
				// Ignore errors - server might not be registered
				resolve();
			});
		});

		// Now register the server
		return new Promise((resolve, reject) => {
			const args = [
				"mcp",
				"add",
				serverName,
				serverUrl,
				"--scope",
				"local",
				"--transport",
				"http",
				"--header",
				"Authorization: not-required",
			];

			const workingDir = this.getVaultPath();
			console.debug("[MCP] Registering MCP server with command:");
			console.debug(`[MCP] claude ${args.join(" ")}`);
			console.debug("[MCP] Working directory:", workingDir);
			console.debug("[MCP] Current process.cwd():", process.cwd());
			console.debug(
				"[MCP] Environment PATH:",
				this.getClaudeEnvironment().PATH,
			);

			const addProcess = spawn("claude", args, {
				env: this.getClaudeEnvironment(),
				cwd: this.getVaultPath(),
				windowsHide: true,
				shell: false,
			});

			let stdout = "";
			let stderr = "";

			addProcess.stdout.on("data", (data: Buffer) => {
				const output = data.toString();
				stdout += output;
				console.debug("[MCP] Add stdout:", output.trim());
			});

			addProcess.stderr.on("data", (data: Buffer) => {
				const output = data.toString();
				stderr += output;
				console.debug("[MCP] Add stderr:", output.trim());
			});

			addProcess.on("close", (code: number) => {
				console.debug(`[MCP] Add command exited with code ${code}`);
				if (code === 0) {
					console.debug("[MCP] MCP server registered successfully");
					console.debug("[MCP] Final registration stdout:", stdout);
					console.debug("[MCP] Final registration stderr:", stderr);
					resolve(void 0);
				} else {
					const errorMsg = `[MCP] Failed to register MCP server. Exit code: ${code}\nstderr: ${stderr}\nstdout: ${stdout}`;
					console.error(errorMsg);
					reject(new Error(errorMsg));
				}
			});

			addProcess.on("error", (error: any) => {
				console.error("[MCP] Failed to spawn claude command:", error);
				reject(new Error(`Failed to spawn claude command: ${error.message}`));
			});
		});
	}

	private getClaudeEnvironment() {
    if (!Platform.isDesktopApp) {
      return {};
    }

		const customEnv = { ...process.env };
		if (this.plugin.settings.envPath) {
			const separator = process.platform === "win32" ? ";" : ":";
			customEnv.PATH =
				this.plugin.settings.envPath + separator + (process.env.PATH || "");
		}

		// Ensure claude command can be found
		if (this.plugin.settings.claudePath) {
			const { dirname } = require("path");
			const claudeDir = dirname(this.plugin.settings.claudePath);
			const separator = process.platform === "win32" ? ";" : ":";
			customEnv.PATH = claudeDir + separator + (customEnv.PATH || "");
		}

		return customEnv;
	}

	private async checkAndCleanExistingProcess(): Promise<void> {
		const { existsSync, readFileSync, unlinkSync } = require("fs");

		if (!existsSync(this.pidFilePath)) {
			return;
		}

		try {
			const pidContent = readFileSync(this.pidFilePath, "utf8");
			const pid = parseInt(pidContent.trim());

			if (!Number.isNaN(pid)) {
				console.debug(`[MCP] Found existing PID file with PID: ${pid}`);

				// Check if process exists and is our MCP server
				if (this.isProcessRunning(pid)) {
					const isOurProcess = await this.verifyProcessIsMcpServer(pid);
					if (isOurProcess) {
						console.debug(
							`[MCP] Killing existing MCP server process (PID: ${pid})`,
						);
						try {
							process.kill(pid, "SIGKILL");
							// Give it a moment to die
							await new Promise((resolve) => setTimeout(resolve, 100));
						} catch (error) {
							console.debug(`[MCP] Failed to kill process ${pid}:`, error);
						}
					} else {
						console.debug(
							`[MCP] Process ${pid} is not our MCP server, removing stale PID file`,
						);
					}
				}

				// Remove PID file
				unlinkSync(this.pidFilePath);
			}
		} catch (error) {
			console.debug("[MCP] Error checking existing PID file:", error);
			// Remove potentially corrupt PID file
			try {
				unlinkSync(this.pidFilePath);
			} catch {}
		}
	}

	private isProcessRunning(pid: number): boolean {
		try {
			// process.kill with signal 0 checks if process exists
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	private async verifyProcessIsMcpServer(pid: number): Promise<boolean> {
    if (!Platform.isDesktopApp) {
      return false;
    }

		try {
			// On macOS/Linux, we can check the process command line
			if (process.platform !== "win32") {
				const { execSync } = require("child_process");
				try {
					// Use ps to get command line
					const cmd = `ps -p ${pid} -o command=`;
					const result = execSync(cmd, { encoding: "utf8" });

					// Check if it's running our main.js with MCP_SERVER_MODE
					return (
						result.includes("main.js") &&
						result.includes("MCP_SERVER_MODE")
					);
				} catch {
					// Process might have died between checks
					return false;
				}
			} else {
				// On Windows, we'll assume any process with our PID is ours
				// This is less safe but Windows makes it harder to check process details
				return true;
			}
		} catch {
			return false;
		}
	}

	private writePidFile(): void {
		try {
			const { writeFileSync, mkdirSync } = require("fs");
			const { dirname } = require("path");

			// Ensure directory exists
			mkdirSync(dirname(this.pidFilePath), { recursive: true });

			// Write PID
			writeFileSync(this.pidFilePath, this.mcpProcess.pid.toString());
			console.debug(
				`[MCP] PID file written: ${this.pidFilePath} (PID: ${this.mcpProcess.pid})`,
			);
		} catch (error) {
			console.error("[MCP] Failed to write PID file:", error);
		}
	}

	private removePidFile(): void {
		try {
			const { existsSync, unlinkSync } = require("fs");
			if (existsSync(this.pidFilePath)) {
				unlinkSync(this.pidFilePath);
				console.debug("[MCP] PID file removed");
			}
		} catch (error) {
			console.debug("[MCP] Failed to remove PID file:", error);
		}
	}
}
