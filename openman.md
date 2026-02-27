# 🤖 OpenMan — Human-Like AI Companion

<p align="center">
    <strong>More Human, More Capable, More Connected</strong>
</p>

**OpenMan** is a _human-like AI companion_ that bridges the gap between AI assistants and human capabilities.

Unlike traditional AI assistants that operate within siloed environments, OpenMan thinks, acts, and interacts like a human would - seamlessly traversing the web, using web-based AI services, leveraging local system tools, and coordinating across multiple platforms.

If you want an AI that truly understands human workflows, navigates the web like a human, and integrates with your digital life naturally, this is it.

## Vision

OpenMan aims to create an AI companion that:

- **Thinks like a human** - Uses reasoning, context, and common sense
- **Navigates like a human** - Browses the web, fills forms, clicks buttons, reads content
- **Uses tools like a human** - Leverages both local applications and cloud services
- **Communicates like a human** - Adapts tone, style, and format to context
- **Learns like a human** - Remembers preferences, patterns, and workflows

## Core Philosophy

### Human-Centric Design

OpenMan is designed with a fundamental shift: **AI should augment human capabilities, not replace them**.

- **Web-First Approach**: The modern world lives on the web. OpenMan can browse, interact, and transact on the web just like a human would
- **Tool Agnostic**: Uses whatever tool is best for the job - web apps, CLI tools, APIs, or AI services
- **Context Awareness**: Understands the context of tasks, conversations, and user preferences
- **Transparent Decision Making**: Explains its thought process and actions when requested

### Privacy & Control

While OpenMan can connect to web services and AI platforms, your privacy remains paramount:

- **Local-First**: Core intelligence runs locally; cloud services are opt-in
- **Data Control**: You decide what data is shared and where
- **Audit Trail**: All actions and decisions are logged and reviewable
- **Revoke Anytime**: Disconnect from any service instantly

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interfaces                         │
│  Web UI • Mobile Apps • Voice • CLI • Integrations          │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                   OpenMan Core                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Reasoning│  │ Planning │  │ Memory   │  │ Learning │   │
│  │ Engine   │  │ Module   │  │ System   │  │ Engine   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────┬───────────────────────────────────────┘
                      │
      ┌───────────────┼───────────────┐
      │               │               │
┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
│  Browser  │  │  Local    │  │  AI      │
│  Engine   │  │  Tools    │  │  Services │
│           │  │           │  │           │
│ • CDP     │  │ • Shell   │  │ • OpenAI  │
│ • Headless│  │ • Apps    │  │ • Anthropic│
│ • Auth    │  │ • Files   │  │ • Claude  │
│ • Forms   │  │ • System  │  │ • Custom  │
└───────────┘  └───────────┘  └───────────┘
```

### Components

#### 1. Browser Engine

OpenMan includes a sophisticated web browsing capability:

- **Headless & Headed Modes**: Operate completely invisible or watch in real-time
- **CDP Integration**: Chrome DevTools Protocol for full control
- **Smart Form Handling**: Autocomplete, validation, CAPTCHA handling
- **Session Management**: Handle logins, cookies, sessions across sites
- **Anti-Detection**: Rotate fingerprints, manage bot detection

**Use Cases:**
- Research: Browse multiple sources, compare information
- Transactions: Book flights, reserve restaurants, buy tickets
- Automation: Fill forms, scrape data, run workflows
- Testing: Verify web applications, run end-to-end tests

#### 2. Local Tools Integration

Leverage the full power of the host system:

- **Shell Commands**: Execute terminal commands with safety checks
- **File Operations**: Read, write, search, and organize files
- **Application Control**: Launch and interact with local apps
- **System APIs**: Access notifications, calendar, contacts (with permissions)

**Safety:**
- Sandbox mode for untrusted operations
- Explicit user approval for destructive actions
- Detailed audit logs for all system changes
- Fine-grained permission controls

#### 3. AI Services Hub

Connect to multiple AI services seamlessly:

- **Multi-Provider Support**: OpenAI, Anthropic, Google, custom endpoints
- **Task Routing**: Route to the best model for the task
- **Cost Optimization**: Use cheaper models for simple tasks
- **Fallback Chains**: Automatic failover between providers
- **Token Management**: Track usage and manage costs

**Built-in Integrations:**
- Web-based AI (ChatGPT, Claude, Perplexity, etc.)
- Specialized AI (coding, creative, analysis)
- Vision models for image understanding
- Voice models for speech synthesis/recognition

#### 4. Reasoning & Planning Engine

The brain behind OpenMan:

- **Context Understanding**: Maintain long-term context across conversations
- **Task Decomposition**: Break complex tasks into actionable steps
- **Error Recovery**: Detect failures and adjust strategies
- **Multi-Step Planning**: Plan ahead and backtrack when needed
- **Tool Selection**: Choose the right tool for each subtask

#### 5. Memory & Learning System

Learn from interactions:

- **Episodic Memory**: Remember specific conversations and events
- **Semantic Memory**: Store general knowledge and patterns
- **User Preferences**: Learn user preferences and workflows
- **Personalization**: Adapt to individual usage patterns
- **Forgetting Mechanism**: Gradually forget old, irrelevant information

## Capabilities

### Web Navigation

OpenMan can navigate the web autonomously:

```javascript
// Example: Research and compare products
await openman.browse('amazon.com')
  .search('wireless headphones')
  .filter({ rating: '4+', price: '100-200' })
  .compare(5, ['price', 'features', 'reviews'])
  .report({ format: 'table' })
```

**Features:**
- Natural language instructions
- Handle dynamic content (SPA, React, etc.)
- Wait for page loads, animations
- Handle popups, modals, overlays
- Take screenshots and snapshots

### Form Automation

Fill and submit forms intelligently:

```javascript
// Example: Register for a service
await openman.browse('service.com/signup')
  .fill({
    email: 'user@example.com',
    password: generateSecurePassword(),
    'company-name': 'Acme Corp'
  })
  .solveCaptcha()
  .submit()
```

**Features:**
- Auto-detect form fields
- Smart field matching
- Validation handling
- CAPTCHA solving (with consent)
- Multi-step forms

### Multi-Platform Coordination

Coordinate across multiple platforms:

```javascript
// Example: Plan a trip
await openman.plan({
  task: 'plan a weekend trip to San Francisco',
  steps: [
    'browse travel websites for flights',
    'compare hotels on booking sites',
    'check weather forecasts',
    'create itinerary in calendar',
    'send summary to phone'
  ]
})
```

### AI Service Orchestration

Use multiple AI services together:

```javascript
// Example: Write and illustrate a blog post
const content = await openman.ai.anthropic.completion({
  model: 'claude-3-opus',
  prompt: 'Write a 1000-word article about...'
})

const images = await openman.ai.openai.image.generate({
  prompt: extractKeyVisuals(content),
  count: 3
})

await openman.files.write('blog-post.md', content)
```

## Security

### Trusted Execution Model

OpenMan operates on a principle of **verified trust**:

1. **Unknown**: New sources are treated as untrusted
2. **Observed**: Actions are logged but may require approval
3. **Trusted**: Approved actions can run automatically
4. **Revoked**: Trust can be withdrawn anytime

### Permission System

Granular controls over what OpenMan can do:

```javascript
{
  "permissions": {
    "web": {
      "browsing": "always",          // Always allow
      "forms": "ask",               // Ask before submitting
      "payments": "never",          // Never allow
      "sensitive": "explicit"       // Require explicit confirmation
    },
    "local": {
      "read": "workspace",          // Only workspace files
      "write": "ask",               // Ask before modifying
      "execute": "sandboxed",       // Only in sandbox
      "system": "never"             // Never touch system
    },
    "ai": {
      "anthropic": "always",
      "openai": "ask",
      "google": "never",
      "custom": "explicit"
    }
  }
}
```

### Audit Logging

All actions are logged:

```javascript
{
  "timestamp": "2026-02-27T10:30:00Z",
  "action": "browser.navigate",
  "url": "https://example.com",
  "reason": "User request: 'Check the latest price'",
  "result": "success",
  "user_approved": true,
  "risk_level": "low"
}
```

## Getting Started

### Installation

```bash
npm install -g openman

# Initialize with interactive setup
openman init
```

### Configuration

```bash
# Interactive configuration
openman config

# Set specific values
openman config set browser.headless true
openman config set ai.anthropic.api_key YOUR_KEY
openman config set permissions.web.forms ask
```

### First Run

```bash
# Start the interactive CLI
openman

# Or use the web UI
openman ui

# Or use voice mode
openman voice
```

## Usage Examples

### Research Assistant

```bash
# Research and summarize
openman "Research the latest developments in AI and summarize the top 5 breakthroughs"
```

OpenMan will:
1. Search multiple sources (Google Scholar, arXiv, news sites)
2. Read and analyze articles
3. Extract key information
4. Synthesize a summary
5. Cite sources

### Shopping Assistant

```bash
# Find best price
openman "Find the best price for Sony WH-1000XM5 headphones, considering shipping and discounts"
```

OpenMan will:
1. Browse Amazon, Best Buy, Walmart, etc.
2. Compare prices, ratings, and availability
3. Check for coupons and deals
2. Consider shipping costs and delivery times
4. Provide a ranked recommendation

### Task Automation

```bash
# Automate a recurring task
openman automations create \
  --name "morning-briefing" \
  --trigger "every weekday at 8am" \
  --steps "
    - Check calendar for today's meetings
    - Fetch weather forecast
    - Browse news for top stories
    - Generate briefing in email
    - Send to my inbox
  "
```

## Comparison: OpenMan vs OpenClaw

| Feature | OpenClaw | OpenMan |
|---------|----------|---------|
| **Focus** | Messaging channels | Web & system interaction |
| **Primary Use** | Chat assistant | Task automation |
| **Web Access** | Limited (via tools) | Full browser engine |
| **System Access** | Via plugins | Native integration |
| **AI Services** | Single model | Multi-provider hub |
| **User Model** | Multi-user | Single-user personal |
| **Setup** | Channel-first | Task-first |
| **Learning** | Minimal | Adaptive memory |

## Project Status

### Current Capabilities

- ✅ Headless browser engine with CDP
- ✅ Multi-provider AI integration
- ✅ Local tool execution (shell, files, apps)
- ✅ Basic reasoning and planning
- ✅ Permission system and audit logging
- ✅ CLI interface
- ✅ Web UI (basic)

### In Development

- 🚧 Advanced memory and learning
- 🚧 Voice interface
- 🚧 Mobile apps (iOS/Android)
- 🚧 Plugin system
- 🚧 Community skills marketplace
- 🚧 Self-hosted AI (via Ollama, LM Studio)

### Planned

- 📋 Screen sharing and remote control
- 📋 Advanced form and CAPTCHA handling
- 📋 Multi-modal understanding (image, video, audio)
- 📋 Distributed task execution (multiple agents)
- 📋 Collaborative features (shared workspaces)

## Contribution

OpenMan is an open-source project. Contributions are welcome!

- **Code**: GitHub PRs
- **Docs**: Documentation improvements
- **Plugins**: Extend capabilities
- **Skills**: Share useful workflows
- **Testing**: Bug reports and testing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

OpenMan is inspired by and builds upon the excellent work of:

- **OpenClaw** - Architecture and design patterns
- **Puppeteer/Playwright** - Browser automation
- **LangChain** - AI orchestration patterns
- **Anthropic** - Claude API and safety practices
- **OpenAI** - GPT API and best practices

## Contact

- **Website**: https://openman.dev
- **Documentation**: https://docs.openman.dev
- **GitHub**: https://github.com/openman/openman
- **Discord**: https://discord.gg/openman
- **Twitter**: [@openman_dev](https://twitter.com/openman_dev)

---

**OpenMan - AI that thinks and acts human**
