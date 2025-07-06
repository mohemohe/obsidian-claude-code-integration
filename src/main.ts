import {
	type App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	type WorkspaceLeaf,
} from "obsidian";
import { ClaudeCodeView, VIEW_TYPE_CLAUDE_CODE } from "./ClaudeCodeView";
import { PermissionMcpServer } from "./services/PermissionMcpServer";

interface ClaudeCodeSettings {
	claudePath: string;
	envPath: string;
	maxTurns: number;
	mcpServerPort: number;
}

export interface ClaudeCodePluginContext {
	permissionServer: PermissionMcpServer | null;
}

const DEFAULT_SETTINGS: ClaudeCodeSettings = {
	claudePath: "",
	envPath: "",
	maxTurns: 10,
	mcpServerPort: 65432,
};

export default class ClaudeCodePlugin extends Plugin {
	settings: ClaudeCodeSettings;
	context: ClaudeCodePluginContext = {
		permissionServer: null,
	};

	async onload() {
		// Get version from manifest
		const manifest = (this as any).manifest;
		const version = manifest?.version || "unknown";
		console.log(`Plugin obsidian-claude-code-integration v${version} initialized`);

		await this.loadSettings();

		// Start MCP permission server
		try {
			this.context.permissionServer = new PermissionMcpServer(this);
			const port = await this.context.permissionServer.start();
			console.log(`MCP Permission server started on port ${port}`);
		} catch (error) {
			console.error("Failed to start MCP permission server:", error);
			new Notice(
				"Failed to start permission server. Some features may not work.",
			);
		}

		// Auto-detect Claude path if not set
		if (!this.settings.claudePath) {
			this.autoDetectClaudePath();
		}

		// Register the view
		this.registerView(
			VIEW_TYPE_CLAUDE_CODE,
			(leaf) => new ClaudeCodeView(leaf, this),
		);

		// Add ribbon icon
		const ribbonIconEl = this.addRibbonIcon(
			"bot",
			"Claude Code",
			(_: MouseEvent) => {
				this.activateView();
			},
		);
		ribbonIconEl.addClass("claude-code-ribbon-icon");

		// Add command to open Claude Code
		this.addCommand({
			id: "open-claude-code",
			name: "Open Claude Code",
			callback: () => {
				this.activateView();
			},
		});

		// Add settings tab
		this.addSettingTab(new ClaudeCodeSettingTab(this.app, this));
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CLAUDE_CODE);

		// Stop MCP permission server
		if (this.context.permissionServer) {
			await this.context.permissionServer.stop();
			console.log("MCP Permission server stopped");
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CODE);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf in the right sidebar
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_CLAUDE_CODE, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async autoDetectClaudePath() {
		// @ts-ignore - Electron provides Node.js APIs
		const { existsSync } = require("fs");
		// @ts-ignore - Electron provides Node.js APIs
		const { join, dirname } = require("path");
		// @ts-ignore - Electron provides Node.js APIs
		const os = require("os");

		const homedir = os.homedir();
		const possiblePaths = [
			"/usr/local/bin/claude",
			"/opt/homebrew/bin/claude",
			join(homedir, ".npm-global/bin/claude"),
			join(homedir, "node_modules/.bin/claude"),
			join(homedir, ".local/bin/claude"),
			join(homedir, ".bun/bin/claude"),
			"C:\\Program Files\\nodejs\\claude.cmd",
			"C:\\Program Files (x86)\\nodejs\\claude.cmd",
		];

		// Common paths for node/npm that might be needed
		const commonNodePaths = [
			"/usr/local/bin",
			"/opt/homebrew/bin",
			"/usr/bin",
			join(homedir, ".bun/bin"),
			join(homedir, ".npm-global/bin"),
			join(homedir, ".nvm/versions/node/*/bin"),
			"C:\\Program Files\\nodejs",
			"C:\\Program Files (x86)\\nodejs",
		];

		for (const path of possiblePaths) {
			if (existsSync(path)) {
				this.settings.claudePath = path;

				// Also try to detect necessary PATH directories
				const pathDir = dirname(path);
				if (!this.settings.envPath && commonNodePaths.includes(pathDir)) {
					this.settings.envPath = pathDir;
				}

				await this.saveSettings();
				console.log(`Auto-detected Claude Code at: ${path}`);
				new Notice(`Claude Code found at: ${path}`);
				break;
			}
		}
	}
}

class ClaudeCodeSettingTab extends PluginSettingTab {
	plugin: ClaudeCodePlugin;

	constructor(app: App, plugin: ClaudeCodePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Claude Code Settings" });

		new Setting(containerEl)
			.setName("Claude Code Path")
			.setDesc("Full path to claude command (leave empty to use PATH)")
			.addText((text) =>
				text
					.setPlaceholder("/usr/local/bin/claude")
					.setValue(this.plugin.settings.claudePath)
					.onChange(async (value) => {
						this.plugin.settings.claudePath = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Environment PATH")
			.setDesc(
				"Additional PATH directories (colon-separated, e.g., /usr/local/bin:/opt/homebrew/bin)",
			)
			.addTextArea((text) =>
				text
					.setPlaceholder(
						"/usr/local/bin:/opt/homebrew/bin:/Users/username/.bun/bin",
					)
					.setValue(this.plugin.settings.envPath)
					.onChange(async (value) => {
						this.plugin.settings.envPath = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("MCP server port")
			.setDesc("Port for the MCP permission server (default: 65432)")
			.addText((text) =>
				text
					.setPlaceholder("65432")
					.setValue(this.plugin.settings.mcpServerPort.toString())
					.onChange(async (value) => {
						const port = parseInt(value);
						if (!Number.isNaN(port) && port > 0 && port < 65536) {
							this.plugin.settings.mcpServerPort = port;
							await this.plugin.saveSettings();
							new Notice(
								"MCP server port changed. Please restart Obsidian to apply changes.",
							);
						}
					}),
			);

		new Setting(containerEl)
			.setName("Test Node.js")
			.setDesc("Test if Node.js can be found and executed")
			.addButton((button) =>
				button.setButtonText("Test Node").onClick(async () => {
					// @ts-ignore - Electron provides Node.js APIs
					const { spawn } = require("child_process");
					// @ts-ignore - Electron provides Node.js APIs
					const { join } = require("path");
					// @ts-ignore - Electron provides Node.js APIs
					const { existsSync } = require("fs");

					// Prepare environment with custom PATH if needed
					const customEnv = { ...process.env };
					if (this.plugin.settings.envPath) {
						const separator = process.platform === "win32" ? ";" : ":";
						customEnv.PATH =
							this.plugin.settings.envPath +
							separator +
							(process.env.PATH || "");
					}

					// Determine node command
					let nodeCommand = "node";
					if (this.plugin.settings.envPath) {
						const separator = process.platform === "win32" ? ";" : ":";
						const paths = this.plugin.settings.envPath.split(separator);

						for (const path of paths) {
							const nodePath = join(path, "node");
							const nodeExePath = join(path, "node.exe");

							if (existsSync(nodePath)) {
								nodeCommand = nodePath;
								break;
							} else if (existsSync(nodeExePath)) {
								nodeCommand = nodeExePath;
								break;
							}
						}
					}

					try {
						const nodeProcess = spawn(nodeCommand, ["--version"], {
							env: customEnv,
							windowsHide: true,
							shell: false,
						});

						let output = "";
						nodeProcess.stdout.on("data", (data: Buffer) => {
							output += data.toString();
						});

						nodeProcess.on("close", (code: number) => {
							if (code === 0) {
								new Notice(
									`Node.js found: ${output.trim()}\nCommand: ${nodeCommand}`,
								);
							} else {
								new Notice(`Node.js test failed with code ${code}`);
							}
						});

						nodeProcess.on("error", (error: Error) => {
							new Notice(`Failed to execute Node.js: ${error.message}`);
						});
					} catch (error) {
						new Notice(`Error testing Node.js: ${error}`);
					}
				}),
			);

		new Setting(containerEl)
			.setName("MCP Permission Server")
			.setDesc("Restart the MCP permission server")
			.addButton((button) =>
				button.setButtonText("Restart Server").onClick(async () => {
					try {
						if (this.plugin.context.permissionServer) {
							new Notice("Restarting MCP permission server...");
							await this.plugin.context.permissionServer.stop();
							const port = await this.plugin.context.permissionServer.start();
							new Notice(`MCP permission server restarted on port ${port}`);
						} else {
							new Notice("MCP permission server not initialized");
						}
					} catch (error) {
						console.error("Failed to restart MCP server:", error);
						new Notice(`Failed to restart MCP server: ${error}`);
					}
				}),
			);

		new Setting(containerEl)
			.setName("Max Turns")
			.setDesc("Maximum number of conversation turns")
			.addText((text) =>
				text
					.setPlaceholder("10")
					.setValue(String(this.plugin.settings.maxTurns))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!Number.isNaN(num) && num > 0) {
							this.plugin.settings.maxTurns = num;
							await this.plugin.saveSettings();
						}
					}),
			);
	}
}
