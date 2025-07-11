# Changelog

All notable changes to the Claude Code Obsidian Integration plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5]

### Added
- Added "ultrathink" checkbox below the input field
  - When checked, automatically appends " ultrathink" to the end of the message
- Added accordion-style display for extended thinking mode messages
  - Automatically expands while Claude is thinking
  - Automatically collapses when the actual response begins

### Changed
- Improved input field layout

### Fixed
- Fixed MCP server port conflict issue on plugin restart
  - Improved process verification logic to correctly identify running MCP server instances
  - Added graceful shutdown handling for HTTP server to properly release ports
  - Extended cleanup wait times to ensure ports are fully released before restart

## [1.0.4]
## [1.0.3]
## [1.0.2]
## [1.0.1]

### Fixed
- Minor bug fixes

## [1.0.0]

### Added
- Initial release of Claude Code Obsidian Integration
- AI-powered coding assistant integrated directly into Obsidian
- Support for Model Context Protocol (MCP)
- React-based user interface for smooth interactions
- Command palette integration
- Ribbon icon for quick access
- Desktop-only support (as per Obsidian plugin requirements)
- Full TypeScript implementation
- Comprehensive documentation

### Technical Details
- Built with React 18 and TypeScript
- Integrates @anthropic-ai/claude-code SDK
- Implements Model Context Protocol for enhanced AI interactions
- Minimum Obsidian version requirement: 0.15.0

### Known Limitations
- Desktop only (mobile not supported due to technical constraints)
- Requires active internet connection for AI features

---

For more information about this plugin, visit the [GitHub repository](https://github.com/mohemohe/obsidian-claude-code-integration).
