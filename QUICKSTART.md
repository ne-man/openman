# OpenMan Quick Start Guide

## Installation

```bash
# Clone the repository
git clone https://github.com/ne-man/openman.git
cd openman

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env and add your API keys
nano .env
```

## Configuration

Add your API keys to `.env`:

```bash
# AI Services (add at least one)
OPENAI_API_KEY=sk-your-openai-key
# or
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
# or
GOOGLE_API_KEY=your-google-api-key

# Browser Configuration
BROWSER_HEADLESS=true
```

## Build

```bash
# Build TypeScript
npm run build

# Or run in development mode
npm run dev
```

## Usage

### Chat with OpenMan

```bash
# Interactive chat
npm run dev chat

# Send a message
npm run dev chat "What is the capital of France?"

# Use specific AI provider
npm run dev chat "Hello" --provider anthropic
```

### Web Browsing

```bash
# Browse to a URL
npm run dev browse https://example.com

# Take a screenshot
npm run dev browse https://example.com --screenshot page.png

# Search the web
npm run dev search "AI news"
```

### Task Planning

```bash
# Plan a task
npm run dev plan "Research and compare iPhone 15 vs Samsung S24"

# Execute a planned task
npm run dev execute task-1234567890
```

### Configuration

```bash
# View current configuration
npm run dev config

# View permissions
npm run dev permissions

# View audit logs
npm run dev logs
```

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format
```

## Project Structure

```
openman/
├── src/
│   ├── ai/           # AI service integrations
│   ├── browser/      # Web browsing engine
│   ├── cli/          # Command-line interface
│   ├── core/         # Core functionality (config, audit, reasoning)
│   ├── permissions/  # Permission management
│   ├── tools/        # Local tools
│   ├── types/        # TypeScript types
│   └── utils/        # Utility functions
├── tests/            # Test files
└── docs/             # Documentation
```

## Next Steps

1. Read the full documentation: `openman.md`
2. Configure your API keys in `.env`
3. Run `npm run build` to build the project
4. Try `npm run dev chat "Hello, OpenMan!"`
5. Explore other commands and features

## Troubleshooting

### Build Errors

If you get TypeScript errors:

```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

### Browser Issues

If browser automation fails:

```bash
# Install required system dependencies
# Ubuntu/Debian:
sudo apt-get install -y chromium-browser

# macOS:
# No additional dependencies needed
```

### API Key Errors

Make sure your API keys are set correctly in `.env`:

```bash
# Check configuration
npm run dev config

# Verify API keys
cat .env | grep API_KEY
```

## Support

- GitHub Issues: https://github.com/ne-man/openman/issues
- Documentation: https://github.com/ne-man/openman/blob/main/openman.md
