# 🤖 OpenMan - Human-Like AI Companion

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

OpenMan is a human-like AI companion that bridges the gap between AI assistants and human capabilities. It can browse the web, use web-based AI services, leverage local system tools, and coordinate across multiple platforms.

## Features

- 🌐 **Web Browsing Engine** - Navigate, interact, and transact on the web autonomously
- 🤖 **Multi-Provider AI Integration** - OpenAI, Anthropic, Google, and more with streaming support
- 🌐 **Web AI Support** - Configure any AI service by name and URL (ChatGPT, Claude, Gemini, etc.)
- 🛠️ **Local Tools Integration** - Shell, files, applications, and system APIs
- 🧠 **Memory & Learning** - Remember preferences, patterns, and workflows (episodic, semantic, and preference memory)
- 📝 **Session Management** - Multi-session chat with history management
- 🔒 **Permission System** - Granular controls over what OpenMan can do
- 📝 **Audit Logging** - All actions and decisions are logged and reviewable
- 🌐 **Web UI** - Beautiful real-time chat interface with streaming responses
- 🔌 **WebSocket Gateway** - Real-time bi-directional communication
- 🔁 **Advanced Error Handling** - Retry mechanisms, circuit breaker, timeout handling
- 📊 **Reasoning & Planning** - Break down complex tasks into actionable steps

## Installation

```bash
# Install dependencies
npm install

# Initialize configuration (optional, for interactive setup)
npm run dev init

# Build the project
npm run build
```

## Quick Start

```bash
# Start Web UI with all services (recommended)
npm run dev start

# Open your browser to http://localhost:3000

# Or use CLI commands
npm run dev chat "Hello, OpenMan!"
npm run dev browse "https://example.com"
npm run dev search "latest AI news"
```

## Usage Examples

### Web AI Configuration (New!)

```bash
# Add a Web AI service (only requires name and url)
npm run dev webai add chatgpt https://chat.openai.com

# Add with custom selectors
npm run dev webai add claude https://claude.ai \
  --input 'div[contenteditable="true"]' \
  --submit 'button[aria-label="Send Message"]'

# List all Web AI services
npm run dev webai list

# Chat with a Web AI
npm run dev webai chat chatgpt "What is TypeScript?"

# Remove a Web AI
npm run dev webai remove chatgpt
```

### Web UI

```bash
# Start the web interface
npm run dev start

# Features:
# - Real-time streaming chat
# - Session management
# - Memory integration
# - Provider/model selection
# - Beautiful responsive UI
```

### CLI Commands

```bash
# Chat with AI (supports streaming)
npm run dev chat "Hello, OpenMan!"

# Research task
npm run dev search "latest TypeScript features"

# Browse web pages
npm run dev browse "https://example.com" --query "What is this about?"

# Plan complex tasks
npm run dev plan "Create a Node.js REST API with authentication"

# Manage memory
npm run dev memory add "I prefer dark mode"
npm run dev memory query "preferences"
npm run dev memory stats

# Manage sessions
npm run dev session list
npm run dev session create "New Conversation"
npm run dev session export <id> --format json

# View logs
npm run dev logs --level info --tail 50

# Configure OpenMan
npm run dev config set --key ai.defaultModel --value "gpt-4"
npm run dev config export
```

## Configuration

OpenMan can be configured via:

- **Environment variables**: `.env` file
- **Config file**: `~/.openman/config.json`
- **Web AI file**: `~/.openman/webai.json`
- **CLI flags**: Command-line arguments

### Web AI Configuration

Web AI services are configured with just `name` and `url`:

```json
// ~/.openman/webai.json
[
  {
    "name": "chatgpt",
    "url": "https://chat.openai.com"
  },
  {
    "name": "claude",
    "url": "https://claude.ai"
  },
  {
    "name": "gemini",
    "url": "https://gemini.google.com",
    "inputSelector": "textarea",
    "responseTimeout": 60000
  }
]
```

Supported Web AI services with auto-detected selectors:
- ChatGPT (chat.openai.com)
- Claude (claude.ai)
- Gemini (gemini.google.com)
- Microsoft Copilot (copilot.microsoft.com)
- Poe (poe.com)

See [openman.md](openman.md) for detailed documentation.

## Project Structure

```
openman/
├── src/
│   ├── core/          # Core systems (config, memory, session, audit, reasoning)
│   ├── browser/       # Web browsing engine
│   ├── ai/            # AI service integrations (OpenAI, Anthropic, Google)
│   │   └── channels/  # Web AI channel handlers (yuanbao, doubao)
│   ├── streaming/     # Streaming AI responses
│   ├── tools/         # Local tools integration
│   ├── permissions/   # Permission system
│   ├── gateway/       # WebSocket gateway
│   ├── web/           # Web UI server
│   ├── web/public/    # Static web UI files (HTML/CSS/JS)
│   ├── cli/           # Command-line interface
│   ├── utils/         # Utility functions (errors, logger)
│   └── types/         # TypeScript types
├── tests/             # Test files (webai.test.ts, core.test.ts)
├── openman            # CLI script
└── README.md          # This file
```

## Development

```bash
# Run all tests
npm test

# Or use the openman script for test filtering
./openman test -case webai          # Run all webai tests
./openman test -case webai.014      # Run specific test
./openman test -list                # List all test cases

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format

# Build
npm run build
```

### Test Cases

OpenMan includes comprehensive test cases for Web AI functionality:

| Case ID | Description |
|---------|-------------|
| webai.001-007 | Configuration and service tests |
| webai.008-010 | Yuanbao channel tests (query, follow-up) |
| webai.011-014 | Image query tests (yuanbao, doubao) |
| webai.015-018 | Code analysis tests |
| webai.019 | Error handling tests |
| core.001-008 | Core functionality tests |

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- OpenClaw - Architecture and design patterns
- Puppeteer - Browser automation
- LangChain - AI orchestration patterns
- Anthropic - Claude API and safety practices

---

**OpenMan - AI that thinks and acts human**
