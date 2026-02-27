# 🤖 OpenMan - Human-Like AI Companion

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

OpenMan is a human-like AI companion that bridges the gap between AI assistants and human capabilities. It can browse the web, use web-based AI services, leverage local system tools, and coordinate across multiple platforms.

## Features

- 🌐 **Web Browsing Engine** - Navigate, interact, and transact on the web autonomously
- 🤖 **Multi-Provider AI Integration** - OpenAI, Anthropic, Google, and more
- 🛠️ **Local Tools Integration** - Shell, files, applications, and system APIs
- 🧠 **Reasoning & Planning** - Break down complex tasks into actionable steps
- 📚 **Memory & Learning** - Remember preferences, patterns, and workflows
- 🔒 **Permission System** - Granular controls over what OpenMan can do
- 📝 **Audit Logging** - All actions and decisions are logged and reviewable

## Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env and add your API keys
nano .env

# Build the project
npm run build
```

## Quick Start

```bash
# Development mode
npm run dev

# Start CLI
npm start

# Start web UI
npm run start ui
```

## Usage Examples

```bash
# Research task
openman "Research the latest AI developments and summarize"

# Shopping assistant
openman "Find the best price for Sony headphones"

# Web automation
openman browse amazon.com --search "wireless mouse" --compare
```

## Configuration

OpenMan can be configured via:

- **Environment variables**: `.env` file
- **Config file**: `~/.openman/config.json`
- **CLI flags**: Command-line arguments

See [openman.md](openman.md) for detailed documentation.

## Project Structure

```
openman/
├── src/
│   ├── core/          # Reasoning, planning, memory
│   ├── browser/       # Web browsing engine
│   ├── ai/           # AI service integrations
│   ├── tools/        # Local tools integration
│   ├── permissions/  # Permission system
│   ├── cli/          # Command-line interface
│   ├── ui/           # Web UI
│   ├── utils/        # Utility functions
│   └── types/        # TypeScript types
├── docs/             # Documentation
└── tests/            # Test files
```

## Development

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format

# Build
npm run build
```

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
