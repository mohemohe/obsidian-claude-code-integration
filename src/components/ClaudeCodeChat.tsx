import * as React from "react";
import { type App, TFile } from "obsidian";
import type ClaudeCodePlugin from "../main";
import { ClaudeCodeService } from "../services/ClaudeCodeService";

import { unstable_batchedUpdates } from "react-dom";
import ReactMarkdown from "react-markdown";

import type {
	Message,
	ChatState,
	PermissionRequest,
	PermissionResponse,
} from "../types";

interface ClaudeCodeChatProps {
	plugin: ClaudeCodePlugin;
	app: App;
}

export const ClaudeCodeChat: React.FC<ClaudeCodeChatProps> = ({
	plugin,
	app,
}) => {
	const [state, setState] = React.useState<ChatState>({
		messages: [],
		isLoading: false,
		error: null,
	});
	const [input, setInput] = React.useState("");
	const [isDragging, setIsDragging] = React.useState(false);
	const [pendingPermissions, setPendingPermissions] = React.useState<
		PermissionRequest[]
	>([]);
	const messagesEndRef = React.useRef<HTMLDivElement>(null);
	const inputRef = React.useRef<HTMLTextAreaElement>(null);
	const claudeService = React.useRef<ClaudeCodeService | null>(null);

	React.useEffect(() => {
		claudeService.current = new ClaudeCodeService(plugin);

		// Set up permission request callback
		if (plugin.context.permissionServer) {
			plugin.context.permissionServer.setCallback({
				onPermissionRequest: (request: PermissionRequest) => {
					// Add permission request as a message in the timeline
					const permissionMessage: Message = {
						id: `perm-${request.id}`,
						role: "system",
						content: "",
						timestamp: request.timestamp,
						type: "permission_request",
						permissionRequest: request,
					};

					setState((prev) => ({
						...prev,
						messages: [...prev.messages, permissionMessage],
					}));

					setPendingPermissions((prev) => [...prev, request]);
				},
			});
		}
	}, [plugin]);

	const scrollToBottom = React.useCallback(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	React.useEffect(() => {
		// Add slight delay to ensure DOM is updated
		setTimeout(() => scrollToBottom(), 50);
	}, [state.messages.length]);

	const handleSend = async () => {
		if (!input.trim() || state.isLoading || !claudeService.current) return;

		const userMessage: Message = {
			id: Date.now().toString(),
			role: "user",
			content: input.trim(),
			timestamp: Date.now(),
		};

		setState((prev) => ({
			...prev,
			messages: [...prev.messages, userMessage],
			isLoading: true,
			error: null,
		}));

		setInput("");

		try {
			await claudeService.current.sendMessage(
				state.messages.concat(userMessage),
				app,
				(newMessage: Message) => {
					console.debug("Adding new message:", newMessage);
					unstable_batchedUpdates(() => {
						setState((prev) => {
							let messages = prev.messages;

							// If it's a text message from assistant, remove any pending permission requests
							if (
								newMessage.role === "assistant" &&
								newMessage.type === "text"
							) {
								// Check if there are any pending permission requests
								const hasPendingPermissions = messages.some(
									(msg) =>
										msg.type === "permission_request" && msg.permissionRequest,
								);

								if (hasPendingPermissions) {
									// Remove pending permission requests
									messages = messages.filter(
										(msg) =>
											!(
												msg.type === "permission_request" &&
												msg.permissionRequest
											),
									);

									// Clear pending permissions state
									setPendingPermissions([]);
								}
							}

							return {
								...prev,
								messages: [...messages, newMessage],
							};
						});
					});
				},
				(messageId: string, update: Partial<Message>) => {
					console.debug("Updating message:", messageId, update);
					unstable_batchedUpdates(() => {
						setState((prev) => {
							// Check if this is a tool result with timeout/error
							if (update.toolResult) {
								const content = update.toolResult.content.toLowerCase();
								if (
									content.includes("permission request timed out") ||
									content.includes("permission denied")
								) {
									// Find and remove any pending permission requests
									const filteredMessages = prev.messages.filter(
										(msg) =>
											!(
												msg.type === "permission_request" &&
												msg.permissionRequest
											),
									);

									// Clear pending permissions
									setPendingPermissions([]);

									return {
										...prev,
										messages: filteredMessages.map((msg) =>
											msg.id === messageId ? { ...msg, ...update } : msg,
										),
									};
								}
							}

							return {
								...prev,
								messages: prev.messages.map((msg) =>
									msg.id === messageId ? { ...msg, ...update } : msg,
								),
							};
						});
					});
				},
			);

			setState((prev) => ({
				...prev,
				isLoading: false,
			}));
		} catch (error) {
			setState((prev) => ({
				...prev,
				isLoading: false,
				error: error instanceof Error ? error.message : "An error occurred",
			}));
		}
	};

	const handleStop = () => {
		if (claudeService.current) {
			claudeService.current.cancelRequest();
		}
    setState((prev) => ({
      ...prev,
      isLoading: false,
    }));
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && e.ctrlKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	};

	const handleDragLeave = () => {
		setIsDragging(false);
	};

	const handleDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);

		const files = Array.from(e.dataTransfer.files);
		const obsidianData = e.dataTransfer.getData("text/plain");

		if (obsidianData) {
			// Handle Obsidian internal drag
			// Check if it's an Obsidian URL
			if (obsidianData.startsWith("obsidian://")) {
				try {
					const url = new URL(obsidianData);
					const params = new URLSearchParams(url.search);
					const fileName = params.get("file");

					if (fileName) {
						// Decode the file name from URL encoding
						const decodedPath = decodeURIComponent(fileName);
						const file = app.vault.getAbstractFileByPath(decodedPath);

						if (file instanceof TFile) {
							const newInput = input + (input ? "\n" : "") + `[[${file.path}]]`;
							setInput(newInput);
							inputRef.current?.focus();
						} else {
							// If file not found, just use the decoded path
							const newInput =
								input + (input ? "\n" : "") + `[[${decodedPath}]]`;
							setInput(newInput);
							inputRef.current?.focus();
						}
					}
				} catch (error) {
					console.error("Failed to parse Obsidian URL:", error);
				}
			} else {
				// Try parsing as JSON for backward compatibility
				try {
					const data = JSON.parse(obsidianData);
					if (data.type === "file" && data.path) {
						const file = app.vault.getAbstractFileByPath(data.path);
						if (file instanceof TFile) {
							const newInput = input + (input ? "\n" : "") + `[[${file.path}]]`;
							setInput(newInput);
							inputRef.current?.focus();
						}
					}
				} catch {
					// If not JSON, might be a plain file path
					const newInput = input + (input ? "\n" : "") + obsidianData;
					setInput(newInput);
					inputRef.current?.focus();
				}
			}
		} else if (files.length > 0) {
			// Handle external file drops
			const fileNames = files.map((file) => file.name).join("\n");
			const newInput = input + (input ? "\n" : "") + fileNames;
			setInput(newInput);
			inputRef.current?.focus();
		}
	};

	const adjustTextareaHeight = React.useCallback(() => {
		if (inputRef.current) {
			inputRef.current.style.height = "auto";
			inputRef.current.style.height = inputRef.current.scrollHeight + "px";
		}
	}, []);

	React.useEffect(() => {
		adjustTextareaHeight();
	}, [input]);

	const handleNewSession = async () => {
		// Clear messages
		setState({
			messages: [],
			isLoading: false,
			error: null,
		});

		// Clear pending permissions
		setPendingPermissions([]);

		// Restart MCP server and Claude Code process
		if (plugin.context.permissionServer) {
			console.log("[Chat] Restarting MCP server for new session...");
			await plugin.context.permissionServer.stop();

			// Wait a bit before restarting
			await new Promise((resolve) => setTimeout(resolve, 500));

			try {
				const port = await plugin.context.permissionServer.start();
				console.log(`[Chat] MCP server restarted on port ${port}`);
			} catch (error) {
				console.error("[Chat] Failed to restart MCP server:", error);
			}
		}

		// Restart Claude Code process
		if (claudeService.current) {
			claudeService.current.restartProcess();
		}
	};

	const handlePermissionResponse = async (
		request: PermissionRequest,
		allowed: boolean,
	) => {
		if (!plugin.context.permissionServer) return;

		const response: PermissionResponse = {
			requestId: request.id,
			allowed,
			message: allowed
				? "Permission granted by user"
				: "Permission denied by user",
		};

		try {
			await plugin.context.permissionServer.respondToPermission(response);

			// Remove from pending list
			setPendingPermissions((prev) => prev.filter((p) => p.id !== request.id));

			// Update the permission message to show it's been responded
			setState((prev) => ({
				...prev,
				messages: prev.messages.map((msg) =>
					msg.id === `perm-${request.id}`
						? {
								...msg,
								content: `${allowed ? "✅" : "❌"} Permission ${allowed ? "granted" : "denied"} for tool: ${request.tool}`,
								permissionRequest: undefined, // Remove the interactive request
							}
						: msg,
				),
			}));
		} catch (error) {
			console.error("Failed to respond to permission request:", error);
		}
	};

	return (
		<div className="claude-code-wrapper">
			<div className="claude-code-topbar">
				<div className="claude-code-topbar-title">Claude Code</div>
				<button
					type="button"
					className="claude-code-topbar-button"
					onClick={handleNewSession}
					disabled={state.isLoading}
					title="Start new conversation"
				>
					New Chat
				</button>
			</div>

			<div className="claude-code-container">
				<div className="claude-code-messages">
					{state.messages.map((message) => (
						<MessageBubble
							key={message.id}
							message={message}
							onPermissionRespond={
								message.type === "permission_request" &&
								message.permissionRequest
									? (allowed) =>
											handlePermissionResponse(
												message.permissionRequest!,
												allowed,
											)
									: undefined
							}
						/>
					))}

					{state.isLoading && (
						<div className="claude-code-loading">
							<span>Claude is thinking</span>
							<div className="claude-code-loading-dots">
								<div className="claude-code-loading-dot"></div>
								<div className="claude-code-loading-dot"></div>
								<div className="claude-code-loading-dot"></div>
							</div>
						</div>
					)}

					{state.error && (
						<div className="claude-code-error">Error: {state.error}</div>
					)}

					<div ref={messagesEndRef} />
				</div>
        {state.isLoading && (
          <div className="claude-code-stop-container">
							<div className="claude-code-stop-button-container">
								<button
									type="button"
									className="claude-code-stop-button"
									onClick={handleStop}
									title="Stop generation"
								>
									<span className="claude-code-stop-icon">⏹️</span>
									<span className="claude-code-stop-text">Stop generate</span>
								</button>
							</div>
            </div>
        )}
				<div
					className="claude-code-input-container"
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					<div
						className={`claude-code-drop-zone ${isDragging ? "active" : ""}`}
					>
						<div className="claude-code-drop-zone-text">
							Drop files here to add to message
						</div>
					</div>
					<div className="claude-code-input-wrapper">
						<textarea
							ref={inputRef}
							className="claude-code-input"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Ask Claude about your vault... (Ctrl + Enter to send)"
							rows={1}
						/>
					</div>
				</div>
			</div>
		</div>
	);
};

interface MessageBubbleProps {
	message: Message;
	onPermissionRespond?: (allowed: boolean) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
	message,
	onPermissionRespond,
}) => {
	const [isExpanded, setIsExpanded] = React.useState(false);

	// Check message type
	const messageType = message.type || "text";

	if (message.role === "user") {
		return (
			<div className="claude-code-message claude-code-message-user">
				<div className="claude-code-message-content claude-code-markdown">
					<ReactMarkdown>{message.content}</ReactMarkdown>
				</div>
			</div>
		);
	}

	// Handle different message types
	if (messageType === "text") {
		return (
			<div className="claude-code-message claude-code-message-assistant">
				<div className="claude-code-message-content claude-code-markdown">
					<ReactMarkdown>{message.content}</ReactMarkdown>
				</div>
			</div>
		);
	}

	if (
		messageType === "permission_request" &&
		message.permissionRequest &&
		onPermissionRespond
	) {
		return (
			<PermissionRequestBubble
				request={message.permissionRequest}
				onRespond={onPermissionRespond}
			/>
		);
	}

	if (messageType === "tool_use" && message.toolUse) {
		// Determine tool status
		let statusIcon = "";
		if (message.isToolComplete && message.toolResult) {
			const resultContent = message.toolResult.content.toLowerCase();
			// Check for permission denial or errors
			if (
				resultContent.includes("permission denied") ||
				resultContent.includes("permission was denied") ||
				resultContent.includes('behavior: "deny"') ||
				resultContent.includes("error") ||
				resultContent.includes("failed") ||
				resultContent.includes("timeout")
			) {
				statusIcon = " 🚫";
			} else {
				statusIcon = " ✅";
			}
		}

		return (
			<div className="claude-code-message claude-code-message-assistant">
				<div className="claude-code-tool-bubble">
					<button
						type="button"
						className="claude-code-tool-header"
						onClick={() => setIsExpanded(!isExpanded)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								setIsExpanded(!isExpanded);
							}
						}}
					>
						<span className="claude-code-tool-arrow">
							{isExpanded ? "▼" : "▶"}
						</span>
						<span className="claude-code-tool-title">
							Using '{message.toolUse.name}' tool...
							{message.isToolComplete && statusIcon}
						</span>
					</button>

					{isExpanded && (
						<div className="claude-code-tool-content">
							<div className="claude-code-tool-section">
								<div className="claude-code-tool-label">Input:</div>
								<pre className="claude-code-tool-json">
									{JSON.stringify(message.toolUse.input, null, 2)}
								</pre>
							</div>

							{message.toolResult && (
								<div className="claude-code-tool-section">
									<div className="claude-code-tool-label">Result:</div>
									<div className="claude-code-tool-result claude-code-markdown">
										<ReactMarkdown>{message.toolResult.content}</ReactMarkdown>
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		);
	}

	// Fallback for unknown message types
	return null;
};

interface PermissionRequestBubbleProps {
	request: PermissionRequest;
	onRespond: (allowed: boolean) => void;
}

const PermissionRequestBubble: React.FC<PermissionRequestBubbleProps> = ({
	request,
	onRespond,
}) => {
	const [isExpanded, setIsExpanded] = React.useState(true);

	return (
		<div className="claude-code-message claude-code-message-permission">
			<div className="claude-code-permission-request">
				<div className="claude-code-permission-header">
					<span className="claude-code-permission-icon">🔐</span>
					<span className="claude-code-permission-title">
						Permission Required
					</span>
				</div>

				<div className="claude-code-permission-content">
					<p>
						Claude wants to use the <strong>{request.tool}</strong> tool
					</p>

					{request.arguments && (
						<div className="claude-code-permission-details">
							<button
								type="button"
								className="claude-code-permission-toggle"
								onClick={() => setIsExpanded(!isExpanded)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										setIsExpanded(!isExpanded);
									}
								}}
							>
								<span className="claude-code-tool-arrow">
									{isExpanded ? "▼" : "▶"}
								</span>
								<span>View details</span>
							</button>

							{isExpanded && (
								<pre className="claude-code-permission-args">
									{JSON.stringify(request.arguments, null, 2)}
								</pre>
							)}
						</div>
					)}

					<div className="claude-code-permission-actions">
						<button
							type="button"
							className="claude-code-permission-button claude-code-permission-allow"
							onClick={() => onRespond(true)}
						>
							Allow
						</button>
						<button
							type="button"
							className="claude-code-permission-button claude-code-permission-deny"
							onClick={() => onRespond(false)}
						>
							Deny
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};
