import { ItemView, type WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { type Root, createRoot } from "react-dom/client";

import { ClaudeCodeChat } from "./components/ClaudeCodeChat";
import type ClaudeCodePlugin from "./main";

export const VIEW_TYPE_CLAUDE_CODE = "claude-code-view";

export class ClaudeCodeView extends ItemView {
	root: Root | null = null;
	plugin: ClaudeCodePlugin;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_CLAUDE_CODE;
	}

	getDisplayText() {
		return "Claude Code";
	}

	getIcon() {
		return "bot";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("claude-code-view");

		const root = createRoot(container);
		this.root = root;

		root.render(
			<React.StrictMode>
				<ClaudeCodeChat plugin={this.plugin} app={this.app} />
			</React.StrictMode>,
		);
	}

	async onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
	}
}
