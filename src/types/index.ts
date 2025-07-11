export interface ToolUse {
	id: string;
	name: string;
	input: any;
}

export interface ToolResult {
	tool_use_id: string;
	content: string;
}

export interface PermissionRequest {
	id: string;
	tool: string;
	arguments: any;
	timestamp: number;
}

export type MessageType = "text" | "tool_use" | "permission_request" | "thinking";

export interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	type?: MessageType;
	toolUse?: ToolUse;
	toolResult?: ToolResult;
	isToolComplete?: boolean;
	permissionRequest?: PermissionRequest;
	thinking?: string;
}

export interface ChatState {
	messages: Message[];
	isLoading: boolean;
	error: string | null;
}

export interface PermissionResponse {
	requestId: string;
	allowed: boolean;
	message?: string;
	updatedInput?: any;
}
