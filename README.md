# Claude Code Obsidian Integration

Integrate [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) AI coding agent into your Obsidian vault.

> [!NOTE]
> This is a third-party community plugin and is not affiliated with, endorsed by, or officially supported by Obsidian. This plugin is independently developed and maintained.

## Features

- **AI-Powered Coding Assistant**: Access Claude Code directly within Obsidian for intelligent code suggestions, explanations, and debugging help
- **Seamless Integration**: Works naturally within your Obsidian workflow without switching between applications
- **React-based UI**: Modern, responsive interface built with React for smooth user experience

## Security & Privacy

> [!IMPORTANT]
> This plugin requires specific permissions to function properly:

### File System Access
This plugin launches and communicates with Claude Code, which requires access to files outside of your Obsidian vault. This is necessary because:

- Claude Code needs to read and write code files in your development projects
- The AI assistant requires context from your codebase to provide accurate suggestions
- File operations (create, edit, delete) are performed based on your instructions to Claude Code

### Local MCP Server
This plugin starts a local Model Context Protocol (MCP) server to:

- **Manage permissions**: Intercept and control file access requests from Claude Code
- **Provide security**: Allow you to approve or deny each file operation before it executes
- **Ensure transparency**: Show you exactly what Claude Code is trying to access

Write, delete, and other call tool operations require your explicit approval through the permission dialog, giving you control over what Claude Code can modify.

> [!CAUTION]
> Claude Code may perform destructive operations. Please follow best practices such as maintaining backups and utilizing [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks).

## Installation

> [!IMPORTANT]
> This plugin requires the official Claude Code to be installed separately. The plugin acts as an integration layer between Obsidian and Claude Code.

### From Obsidian Community Plugins (Recommended)

// TODO:

### Manual Installation

1. Download the latest release from the [GitHub releases page](https://github.com/mohemohe/obsidian-claude-code-integration/releases)
2. Extract the files into your vault's `.obsidian/plugins/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Usage

1. After enabling the plugin, you can access Claude Code through:
   - The ribbon icon in the left sidebar
   - Command palette: `Claude Code Integration: Open Claude Code`
   
2. Configure the plugin settings:
   - Claude Code installation path (if not in default location)
   - Node.js PATH (if needed)
   - Other plugin-specific settings
   
3. Start coding with AI assistance directly in your Obsidian vault!

Note: API settings are managed by Claude Code (CLI) itself, not through the plugin settings.

## Requirements

- Obsidian v0.15.0 or higher
- Desktop only (not available on mobile due to technical limitations)
- Active internet connection for AI features

## Development

This plugin is built using:
- TypeScript
- React 18
- Obsidian Plugin API
- @anthropic-ai/claude-code SDK
- Model Context Protocol (MCP)

### Building from Source

```bash
# Clone the repository
git clone https://github.com/mohemohe/obsidian-claude-code-integration.git

# Install dependencies
npm install

# Build the plugin
npm run build

```

## Support

- **Issues**: Please report bugs and feature requests on our [GitHub Issues page](https://github.com/mohemohe/obsidian-claude-code-integration/issues)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
