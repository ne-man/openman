#!/usr/bin/env node
/**
 * OpenMan CLI Interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { BrowserEngine } from '@/browser/engine';
import { aiService } from '@/ai/service';
import { localTools } from '@/tools/local';
import { reasoningEngine } from '@/core/reasoning';
import { permissionManager } from '@/permissions/manager';
import { config } from '@/core/config';
import { auditLogger } from '@/core/audit';
import { memorySystem } from '@/core/memory';
import { sessionManager } from '@/core/session';
import type { Session } from '@/core/session';
import type { MemoryQuery } from '@/core/memory';

const program = new Command();

program
  .name('openman')
  .description('Human-like AI companion with web browsing, AI services, and local tools')
  .version('0.1.0');

// ============================================================================
// Core Commands
// ============================================================================

program
  .command('chat [message...]')
  .description('Chat with OpenMan (auto-fallback to Web AI if no API configured)')
  .option('-v, --verbose', 'verbose output')
  .option('-p, --provider <provider>', 'AI provider to use (openai, anthropic, webai, auto)')
  .option('-w, --webai <name>', 'use specific Web AI by name')
  .action(async (message, options) => {
    const spinner = ora('Initializing OpenMan...').start();

    try {
      // Show provider status
      const bestProvider = aiService.getBestProvider();
      const hasAPI = aiService.hasAPIProvider();

      if (options.verbose) {
        spinner.info(chalk.gray(`API configured: ${hasAPI ? 'Yes' : 'No'}`));
        spinner.info(chalk.gray(`Best provider: ${bestProvider}`));
      }

      // Determine provider
      let provider = options.provider;
      if (!provider || provider === 'auto') {
        provider = bestProvider;
        if (!hasAPI) {
          spinner.info(chalk.yellow('No API key configured, using Web AI (browser-based)'));
        }
      }

      const input = message ? message.join(' ') : await getUserInput();
      spinner.text = `Sending to ${provider}...`;

      console.log(chalk.cyan('\n🤖 You: ' + input + '\n'));

      const response = await aiService.completion([
        {
          role: 'system',
          content: 'You are OpenMan, a helpful AI assistant with web browsing, AI services, and local tools capabilities. Be helpful, concise, and practical.',
        },
        {
          role: 'user',
          content: input,
        },
      ], provider as any);

      spinner.stop();
      console.log(chalk.green('💬 OpenMan: ' + response.content));
      
      const tokenInfo = response.usage?.totalTokens ? `${response.usage.totalTokens} tokens` : 'Web AI';
      console.log(chalk.gray(`\n[${tokenInfo} via ${response.provider}${response.model ? ` (${response.model})` : ''}]`));

      // Close web AI browser if used
      if (response.provider === 'webai') {
        await aiService.closeWebAI();
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      if (error.message.includes('Web AI')) {
        console.log(chalk.yellow('\nTip: Add a Web AI with: openman webai add <name> <url>'));
        console.log(chalk.yellow('Example: openman webai add doubao https://www.doubao.com/chat/'));
      }
      process.exit(1);
    }
  });

// ============================================================================
// Smart Task Command - Natural Language Device Testing
// ============================================================================

program
  .command('task <description...>')
  .description('Execute a task on connected device using natural language')
  .option('-d, --device <id>', 'specific device ID')
  .option('-v, --verbose', 'show detailed steps')
  .action(async (description: string[], options: { device?: string; verbose?: boolean }) => {
    const taskDescription = description.join(' ');
    const spinner = ora('Initializing task...').start();

    try {
      const { DeviceTools } = await import('@/tools/device');
      const { webAIService } = await import('@/ai/webai');
      const fs = await import('fs/promises');
      const path = await import('path');

      const deviceTools = new DeviceTools();

      // Step 1: Detect device
      spinner.text = '🔍 Detecting connected devices...';
      const devices = await deviceTools.listDevices();
      
      if (devices.length === 0) {
        spinner.fail(chalk.red('No devices connected'));
        console.log(chalk.yellow('\nConnect a device via USB and try again.'));
        process.exit(1);
      }

      let targetDevice = devices[0];
      if (options.device) {
        const found = devices.find(d => d.id === options.device);
        if (!found) {
          spinner.fail(chalk.red(`Device ${options.device} not found`));
          process.exit(1);
        }
        targetDevice = found;
      }

      spinner.succeed(chalk.green(`Device: ${targetDevice.model} (${targetDevice.id})`));

      // Step 2: Take screenshot
      spinner.start('📸 Capturing screen...');
      const screenshotResult = await deviceTools.takeScreenshot({ deviceId: targetDevice.id });
      
      if (!screenshotResult.success || !screenshotResult.data?.path) {
        spinner.fail(chalk.red('Failed to capture screenshot'));
        process.exit(1);
      }

      const screenshotPath = screenshotResult.data.path;
      spinner.succeed(chalk.green('Screenshot captured'));

      // Step 3: Analyze screen with AI
      spinner.start('🤖 Analyzing screen and planning task...');
      
      // Get default Web AI
      const webAIs = config.listWebAIs();
      if (webAIs.length === 0) {
        spinner.fail(chalk.red('No Web AI configured. Run: openman webai add doubao https://www.doubao.com/chat/'));
        process.exit(1);
      }
      
      const webAI = webAIs[0];
      webAIService.addConfig(webAI);

      const analysisPrompt = `你是一个智能设备测试助手。

用户任务: ${taskDescription}

请分析这张设备截图，然后：
1. 描述当前屏幕显示的内容（当前打开的是什么应用）
2. 根据用户任务，列出需要执行的具体操作步骤
3. 每个步骤说明需要点击的位置或输入的内容

请用以下格式回复：
【当前界面】: 简要描述
【操作步骤】:
1. 步骤1（动作类型: 点击/输入/滑动, 目标: 具体位置或元素）
2. 步骤2
...
【预期结果】: 完成后应该看到什么`;

      const analysis = await webAIService.queryWithImage(webAI.name, screenshotPath, analysisPrompt);
      
      spinner.succeed(chalk.green('Analysis complete'));

      // Display results
      console.log(chalk.cyan('\n' + '='.repeat(60)));
      console.log(chalk.cyan('📋 Task Analysis'));
      console.log(chalk.cyan('='.repeat(60)));
      console.log(chalk.white(`\n🎯 Task: ${taskDescription}\n`));
      console.log(chalk.white(analysis));
      console.log(chalk.cyan('\n' + '='.repeat(60)));

      // Interactive conversation loop
      const readline = await import('readline');
      
      console.log(chalk.gray('\n💬 You can now ask follow-up questions or give instructions.'));
      console.log(chalk.gray('   Commands: "screenshot" - take new screenshot, "exit" - end task\n'));

      while (true) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const userInput = await new Promise<string>((resolve) => {
          rl.question(chalk.cyan('You > '), (answer) => {
            rl.close();
            resolve(answer.trim());
          });
        });

        if (!userInput) continue;

        // Check for special commands
        if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === '退出') {
          console.log(chalk.gray('\nTask completed.'));
          break;
        }

        if (userInput.toLowerCase() === 'screenshot' || userInput.toLowerCase() === '截图') {
          spinner.start('📸 Taking new screenshot...');
          const newScreenshot = await deviceTools.takeScreenshot({ deviceId: targetDevice.id });
          spinner.succeed(chalk.green('New screenshot captured'));
          
          if (newScreenshot.data?.path) {
            console.log(chalk.gray(`  Saved: ${newScreenshot.data.path}`));
            
            // Upload new screenshot and ask AI to analyze
            spinner.start('🤖 Analyzing new screenshot...');
            const newAnalysis = await webAIService.queryWithImage(
              webAI.name, 
              newScreenshot.data.path, 
              '请分析这张新的截图，描述当前界面的状态和变化'
            );
            spinner.succeed(chalk.green('Analysis complete'));
            console.log(chalk.green('\n🤖 AI: ') + newAnalysis + '\n');
          }
          continue;
        }

        // Send follow-up question to AI
        spinner.start('🤖 Thinking...');
        try {
          const response = await webAIService.followUp(userInput);
          spinner.succeed(chalk.green('Response received'));
          console.log(chalk.green('\n🤖 AI: ') + response + '\n');
        } catch (error: any) {
          spinner.fail(chalk.red('Error: ' + error.message));
        }
      }

      await webAIService.close();

    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      if (options.verbose) {
        console.error(error);
      }
      process.exit(1);
    }
  });

// ============================================================================
// Status Command
// ============================================================================

program
  .command('status')
  .description('Show OpenMan status and available AI providers')
  .action(() => {
    console.log(chalk.cyan('\n📊 OpenMan Status\n'));

    // Check API providers
    console.log(chalk.white('API Providers:'));
    const providers = ['openai', 'anthropic', 'google'] as const;
    providers.forEach((provider) => {
      const available = aiService.isProviderAvailable(provider);
      const status = available ? chalk.green('✓ configured') : chalk.gray('✗ not configured');
      console.log(`  ${provider}: ${status}`);
    });

    // Check Web AI
    console.log(chalk.white('\nWeb AI:'));
    const webAIs = config.listWebAIs();
    if (webAIs.length === 0) {
      console.log(chalk.gray('  No custom Web AI configured'));
      console.log(chalk.gray('  Default: doubao, chatgpt, claude (built-in)'));
    } else {
      webAIs.forEach((ai) => {
        console.log(`  ${chalk.green('✓')} ${ai.name}: ${ai.url}`);
      });
    }

    // Show best provider
    const bestProvider = aiService.getBestProvider();
    console.log(chalk.white('\nCurrent Provider:'));
    console.log(`  ${chalk.cyan(bestProvider)} (auto-selected)`);

    if (!aiService.hasAPIProvider()) {
      console.log(chalk.yellow('\n⚠️  No API keys configured. Will use Web AI (browser-based).'));
      console.log(chalk.gray('   Set OPENAI_API_KEY or ANTHROPIC_API_KEY for faster responses.'));
    }
  });

program
  .command('browse <url>')
  .description('Browse to a URL')
  .option('-s, --screenshot <path>', 'take screenshot')
  .option('-h, --headless', 'run in headless mode', true)
  .action(async (url, options) => {
    const spinner = ora('Starting browser...').start();

    try {
      const browser = new BrowserEngine({
        headless: options.headless,
      });

      await browser.initialize();
      spinner.text = `Navigating to ${url}...`;

      const { page, ...snapshot } = await browser.navigate(url);
      spinner.succeed(chalk.green('Navigation complete'));

      console.log(chalk.cyan('\n📄 Page Information:'));
      console.log(chalk.white(`  Title: ${snapshot.title}`));
      console.log(chalk.white(`  URL: ${snapshot.url}`));
      console.log(chalk.white(`  Text length: ${snapshot.text?.length || 0} characters`));

      if (options.screenshot) {
        await browser.screenshot(page, options.screenshot);
        console.log(chalk.green(`\n✓ Screenshot saved to ${options.screenshot}`));
      }

      await browser.close();
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

program
  .command('search <query>')
  .description('Search the web')
  .option('-e, --engine <engine>', 'search engine', 'google')
  .action(async (query, options) => {
    const spinner = ora(`Searching for "${query}"...`).start();

    try {
      const browser = new BrowserEngine({ headless: true });
      await browser.initialize();

      const snapshot = await browser.search(query, options.engine);
      spinner.succeed(chalk.green('Search complete'));

      console.log(chalk.cyan('\n🔍 Search Results:'));
      console.log(chalk.white(`  Title: ${snapshot.title}`));
      console.log(chalk.white(`  URL: ${snapshot.url}`));

      if (snapshot.text) {
        const preview = snapshot.text.substring(0, 500);
        console.log(chalk.gray(`\n  Preview: ${preview}...`));
      }

      await browser.close();
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

program
  .command('plan <task>')
  .description('Plan a complex task')
  .action(async (task) => {
    const spinner = ora('Planning task...').start();

    try {
      const plannedTask = await reasoningEngine.planTask(task);
      spinner.succeed(chalk.green('Task planned'));

      console.log(chalk.cyan('\n📋 Task Plan:'));
      console.log(chalk.white(`  ID: ${plannedTask.id}`));
      console.log(chalk.white(`  Description: ${plannedTask.description}`));
      console.log(chalk.white(`  Status: ${plannedTask.status}`));

      if (plannedTask.subtasks && plannedTask.subtasks.length > 0) {
        console.log(chalk.cyan('\n  Subtasks:'));
        plannedTask.subtasks.forEach((subtask, index) => {
          console.log(chalk.white(`    ${index + 1}. ${subtask.description}`));
        });
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

program
  .command('execute <taskId>')
  .description('Execute a planned task')
  .action(async (taskId) => {
    const spinner = ora('Executing task...').start();

    try {
      const task = reasoningEngine.getTask(taskId);
      if (!task) {
        spinner.fail(chalk.red('Task not found'));
        process.exit(1);
      }

      const executedTask = await reasoningEngine.executeTask(task);
      spinner.succeed(chalk.green('Task executed'));

      console.log(chalk.cyan('\n✓ Task Complete:'));
      console.log(chalk.white(`  ID: ${executedTask.id}`));
      console.log(chalk.white(`  Status: ${executedTask.status}`));
      if (executedTask.result) {
        console.log(chalk.white(`  Result: ${executedTask.result}`));
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

// ============================================================================
// Memory Commands
// ============================================================================

const memoryCmd = program.command('memory').description('Memory management commands');

memoryCmd
  .command('add <content>')
  .description('Add a memory')
  .option('-t, --type <type>', 'memory type (episodic, semantic, preference)', 'episodic')
  .option('-i, --importance <number>', 'importance score (0-1)')
  .option('--tags <tags>', 'comma-separated tags')
  .action(async (content, options) => {
    const spinner = ora('Adding memory...').start();

    try {
      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined;
      const importance = options.importance ? parseFloat(options.importance) : undefined;

      const memory = await memorySystem.addMemory(content, options.type, {
        importance,
        tags,
      });

      spinner.succeed(chalk.green('Memory added'));
      console.log(chalk.cyan(`\nMemory ID: ${memory.id}`));
      console.log(chalk.white(`Type: ${memory.type}`));
      console.log(chalk.white(`Importance: ${(memory.importance || 0).toFixed(2)}`));
      if (tags && tags.length > 0) {
        console.log(chalk.white(`Tags: ${tags.join(', ')}`));
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

memoryCmd
  .command('list')
  .description('List memories')
  .option('-t, --type <type>', 'filter by type')
  .option('-l, --limit <number>', 'limit results', '10')
  .option('--recent', 'show recent memories')
  .action(async (options) => {
    const spinner = ora('Loading memories...').start();

    try {
      let memories;
      if (options.recent) {
        memories = memorySystem.getRecentMemories(parseInt(options.limit), options.type);
      } else {
        memories = await memorySystem.queryMemories({
          type: options.type as any,
          limit: parseInt(options.limit),
        });
      }

      spinner.succeed(chalk.green(`Found ${memories.length} memories`));

      console.log(chalk.cyan('\n💾 Memories:'));
      memories.forEach((memory, index) => {
        console.log(chalk.white(`\n  ${index + 1}. [${memory.type}] ${formatDate(memory.timestamp)}`));
        console.log(chalk.gray(`     ${memory.content.substring(0, 100)}...`));
        console.log(chalk.gray(`     Importance: ${(memory.importance || 0).toFixed(2)}`));
      });

      const stats = memorySystem.getStatistics();
      console.log(chalk.cyan(`\n📊 Statistics:`));
      console.log(chalk.white(`  Total: ${stats.total}`));
      console.log(chalk.white(`  Average Importance: ${stats.averageImportance.toFixed(2)}`));
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

memoryCmd
  .command('search <query>')
  .description('Search memories')
  .option('-l, --limit <number>', 'limit results', '10')
  .action(async (query, options) => {
    const spinner = ora('Searching memories...').start();

    try {
      const memories = memorySystem.searchMemories(query, parseInt(options.limit));

      spinner.succeed(chalk.green(`Found ${memories.length} memories`));

      console.log(chalk.cyan('\n🔍 Search Results:'));
      memories.forEach((memory, index) => {
        console.log(chalk.white(`\n  ${index + 1}. [${memory.type}] ${formatDate(memory.timestamp)}`));
        console.log(chalk.white(`     ${memory.content.substring(0, 150)}...`));
      });
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

memoryCmd
  .command('stats')
  .description('Show memory statistics')
  .action(() => {
    const stats = memorySystem.getStatistics();

    console.log(chalk.cyan('\n📊 Memory Statistics:'));
    console.log(chalk.white(`  Total Memories: ${stats.total}`));
    console.log(chalk.white(`  Average Importance: ${stats.averageImportance.toFixed(2)}`));
    console.log(chalk.white(`  Oldest Memory: ${stats.oldestDate ? formatDate(stats.oldestDate) : 'N/A'}`));
    console.log(chalk.white(`  Newest Memory: ${stats.newestDate ? formatDate(stats.newestDate) : 'N/A'}`));

    console.log(chalk.cyan('\n  By Type:'));
    Object.entries(stats.byType).forEach(([type, count]) => {
      console.log(chalk.white(`    ${type}: ${count}`));
    });
  });

memoryCmd
  .command('export [file]')
  .description('Export memories')
  .action(async (file) => {
    const spinner = ora('Exporting memories...').start();

    try {
      const exportPath = await memorySystem.exportMemories(file);
      spinner.succeed(chalk.green(`Exported to ${exportPath}`));
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

// ============================================================================
// Session Commands
// ============================================================================

const sessionCmd = program.command('session').description('Session management commands');

sessionCmd
  .command('create <name>')
  .description('Create a new session')
  .option('-p, --provider <provider>', 'AI provider', 'openai')
  .option('-m, --model <model>', 'AI model', 'gpt-4')
  .action(async (name, options) => {
    const spinner = ora('Creating session...').start();

    try {
      const session = await sessionManager.createSession(name, options.provider as any, options.model);

      spinner.succeed(chalk.green('Session created'));
      console.log(chalk.cyan(`\nSession ID: ${session.id}`));
      console.log(chalk.white(`Name: ${session.name}`));
      console.log(chalk.white(`Provider: ${session.provider}`));
      console.log(chalk.white(`Model: ${session.model}`));
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

sessionCmd
  .command('list')
  .description('List all sessions')
  .action(async () => {
    const sessions = sessionManager.listSessions();

    console.log(chalk.cyan('\n📝 Sessions:'));
    sessions.forEach((session, index) => {
      const current = sessionManager.getCurrentSession()?.id === session.id;
      const marker = current ? '★' : ' ';
      console.log(chalk.white(`\n  ${marker} ${index + 1}. ${session.name}`));
      console.log(chalk.gray(`     ID: ${session.id}`));
      console.log(chalk.gray(`     Messages: ${session.messages.length}`));
      console.log(chalk.gray(`     Updated: ${formatDate(session.updatedAt)}`));
    });

    const stats = sessionManager.getStatistics();
    console.log(chalk.cyan(`\n📊 Statistics:`));
    console.log(chalk.white(`  Total Sessions: ${stats.total}`));
    console.log(chalk.white(`  Total Messages: ${stats.totalMessages}`));
  });

sessionCmd
  .command('switch <id>')
  .description('Switch to a session')
  .action(async (id) => {
    const success = sessionManager.setCurrentSession(id);

    if (success) {
      const session = sessionManager.getSession(id);
      console.log(chalk.green(`\n✓ Switched to session: ${session?.name}`));
    } else {
      console.log(chalk.red('\n✗ Session not found'));
      process.exit(1);
    }
  });

sessionCmd
  .command('delete <id>')
  .description('Delete a session')
  .action(async (id) => {
    const spinner = ora('Deleting session...').start();

    try {
      const success = await sessionManager.deleteSession(id);

      if (success) {
        spinner.succeed(chalk.green('Session deleted'));
      } else {
        spinner.fail(chalk.red('Session not found'));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

sessionCmd
  .command('export <id> [file]')
  .description('Export a session')
  .option('-f, --format <format>', 'export format (json, txt)', 'json')
  .action(async (id, file, options) => {
    const spinner = ora('Exporting session...').start();

    try {
      const content = await sessionManager.exportSession(id, options.format as any);

      if (content) {
        if (file) {
          await import('fs/promises').then(fs => fs.writeFile(file, content, 'utf-8'));
          spinner.succeed(chalk.green(`Exported to ${file}`));
        } else {
          spinner.stop();
          console.log(chalk.cyan('\n📄 Session Export:'));
          console.log(content);
        }
      } else {
        spinner.fail(chalk.red('Session not found'));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

// ============================================================================
// System Commands
// ============================================================================

program
  .command('start')
  .description('Start OpenMan services')
  .option('-w, --web', 'start web server')
  .option('-g, --gateway', 'start WebSocket gateway')
  .option('--all', 'start all services')
  .action(async (options) => {
    if (!options.web && !options.gateway && !options.all) {
      options.all = true;
    }

    const { WebServer } = await import('@/web/server');

    if (options.web || options.all) {
      const webServer = new WebServer();
      console.log(chalk.cyan('\n🌐 Starting Web UI server...\n'));
      await webServer.start();
    }

    console.log(chalk.green('\n✓ OpenMan services started'));
    console.log(chalk.white('\nAccess Web UI at: http://localhost:3000'));
    console.log(chalk.white('WebSocket Gateway at: ws://localhost:3001'));
  });

program
  .command('init')
  .description('Initialize OpenMan configuration')
  .action(async () => {
    console.log(chalk.cyan('\n🚀 Initializing OpenMan...\n'));

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Get OpenAI API key
    const openaiKey = await question(
      rl,
      chalk.cyan('Enter your OpenAI API key (or press Enter to skip): ')
    );

    // Get Anthropic API key
    const anthropicKey = await question(
      rl,
      chalk.cyan('Enter your Anthropic API key (or press Enter to skip): ')
    );

    // Get Google API key
    const googleKey = await question(
      rl,
      chalk.cyan('Enter your Google API key (or press Enter to skip): ')
    );

    rl.close();

    // Update environment variables
    if (openaiKey) process.env.OPENAI_API_KEY = openaiKey;
    if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;
    if (googleKey) process.env.GOOGLE_API_KEY = googleKey;

    // Validate configuration
    const validation = config.validate();
    if (!validation.valid) {
      console.log(chalk.red('\n✗ Configuration errors:'));
      validation.errors.forEach(error => {
        console.log(chalk.red(`  - ${error}`));
      });
      process.exit(1);
    }

    // Save configuration
    await config.save();

    console.log(chalk.green('\n✓ OpenMan initialized successfully!'));
    console.log(chalk.white('\nNext steps:'));
    console.log(chalk.white('  npm run build'));
    console.log(chalk.white('  npm run dev start'));
    console.log(chalk.white('  npm run dev chat "Hello, OpenMan!"'));
  });

// ============================================================================
// Config Commands
// ============================================================================

const configCmd = program.command('config').description('Configuration management commands');

configCmd
  .command('save')
  .description('Save configuration to file')
  .action(async () => {
    const spinner = ora('Saving configuration...').start();

    try {
      await config.save();
      spinner.succeed(chalk.green(`Configuration saved to ${config.getConfigPath()}`));
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

configCmd
  .command('validate')
  .description('Validate configuration')
  .action(() => {
    const validation = config.validate();

    if (validation.valid) {
      console.log(chalk.green('\n✓ Configuration is valid'));
    } else {
      console.log(chalk.red('\n✗ Configuration errors:'));
      validation.errors.forEach(error => {
        console.log(chalk.red(`  - ${error}`));
      });
      process.exit(1);
    }
  });

configCmd
  .command('export [file]')
  .description('Export configuration')
  .option('-s, --show-secrets', 'include API keys')
  .action(async (file, options) => {
    const exportData = config.export(options.showSecrets);

    if (file) {
      await import('fs/promises').then(fs => fs.writeFile(file, exportData, 'utf-8'));
      console.log(chalk.green(`\n✓ Exported to ${file}`));
    } else {
      console.log(chalk.cyan('\n📄 Configuration Export:'));
      console.log(exportData);
    }
  });

// ============================================================================
// Permission Commands
// ============================================================================

const permCmd = program.command('permissions').description('Permission management commands');

permCmd
  .description('Show current permissions')
  .action(() => {
    const perms = permissionManager.getAllPermissions();

    console.log(chalk.cyan('\n🔒 Permissions:'));
    Object.entries(perms).forEach(([category, actions]) => {
      console.log(chalk.white(`\n  ${category}:`));
      Object.entries(actions as Record<string, string>).forEach(([action, permission]) => {
        const status = permission === 'always' ? '✓' : permission === 'never' ? '✗' : '?';
        const color = permission === 'always' ? 'green' : permission === 'never' ? 'red' : 'yellow';
        console.log(chalk[color](`    ${status} ${action}: ${permission}`));
      });
    });
  });

permCmd
  .command('set <category> <action> <permission>')
  .description('Set a permission')
  .action((category, action, permission) => {
    const validCategories = ['web', 'local', 'ai'];
    const validPermissions = ['always', 'ask', 'never', 'explicit'];

    if (!validCategories.includes(category)) {
      console.log(chalk.red(`\n✗ Invalid category: ${category}`));
      console.log(chalk.yellow(`Valid categories: ${validCategories.join(', ')}`));
      process.exit(1);
    }

    if (!validPermissions.includes(permission)) {
      console.log(chalk.red(`\n✗ Invalid permission: ${permission}`));
      console.log(chalk.yellow(`Valid permissions: ${validPermissions.join(', ')}`));
      process.exit(1);
    }

    permissionManager.setPermission(
      category as any,
      action,
      permission as any
    );

    console.log(chalk.green(`\n✓ Set ${category}.${action} to ${permission}`));
  });

permCmd
  .command('show <category> <action>')
  .description('Show permission description')
  .action((category, action) => {
    const description = permissionManager.getPermissionDescription(category, action);
    console.log(chalk.cyan(`\n${category}.${action}:`));
    console.log(chalk.white(description));
  });

// ============================================================================
// System Commands
// ============================================================================

program
  .command('logs [action]')
  .description('View audit logs')
  .option('-a, --action <action>', 'filter by action')
  .option('-r, --risk <level>', 'filter by risk level')
  .option('-l, --limit <number>', 'limit results', '10')
  .action(async (action, options) => {
    let logs;

    if (options.action) {
      logs = await auditLogger.searchLogs(options.action);
    } else if (options.risk) {
      logs = await auditLogger.searchLogs(undefined, options.risk);
    } else {
      logs = await auditLogger.getLogs();
    }

    const limit = parseInt(options.limit);
    const displayLogs = logs.slice(-limit);

    console.log(chalk.cyan(`\n📝 Audit Logs (showing last ${displayLogs.length}):`));
    displayLogs.forEach((log: any) => {
      const status = log.result === 'success' ? '✓' : '✗';
      const color = log.result === 'success' ? 'green' : 'red';
      console.log(chalk[color](`\n  ${status} ${formatDate(new Date(log.timestamp))}`));
      console.log(chalk.white(`     ${log.action}`));
      if (log.details) {
        console.log(chalk.gray(`     ${JSON.stringify(log.details, null, 2).substring(0, 100)}...`));
      }
    });
  });

// ============================================================================
// Web AI Commands
// ============================================================================

const webaiCmd = program.command('webai').description('Web AI service commands');

webaiCmd
  .command('add <name> <url>')
  .description('Add a Web AI service')
  .option('-i, --input <selector>', 'CSS selector for input field')
  .option('-s, --submit <selector>', 'CSS selector for submit button')
  .option('-r, --response <selector>', 'CSS selector for response area')
  .option('-t, --timeout <ms>', 'Response timeout in ms', '60000')
  .action(async (name, url, options) => {
    const spinner = ora(`Adding Web AI "${name}"...`).start();

    try {
      await config.addWebAI({
        name,
        url,
        inputSelector: options.input,
        submitSelector: options.submit,
        responseSelector: options.response,
        responseTimeout: parseInt(options.timeout),
      });

      spinner.succeed(chalk.green(`Web AI "${name}" added`));
      console.log(chalk.gray(`  URL: ${url}`));
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

webaiCmd
  .command('list')
  .description('List all Web AI services')
  .action(() => {
    const webais = config.listWebAIs();

    if (webais.length === 0) {
      console.log(chalk.yellow('\nNo Web AI services configured'));
      console.log(chalk.gray('\nAdd one with: openman webai add <name> <url>'));
      return;
    }

    console.log(chalk.cyan('\n🌐 Web AI Services:'));
    webais.forEach((ai, index) => {
      console.log(chalk.white(`\n  ${index + 1}. ${ai.name}`));
      console.log(chalk.gray(`     URL: ${ai.url}`));
      if (ai.inputSelector) {
        console.log(chalk.gray(`     Input: ${ai.inputSelector}`));
      }
      if (ai.responseTimeout) {
        console.log(chalk.gray(`     Timeout: ${ai.responseTimeout}ms`));
      }
    });

    console.log(chalk.cyan(`\n📊 Total: ${webais.length} Web AI service(s)`));
  });

webaiCmd
  .command('remove <name>')
  .description('Remove a Web AI service')
  .action(async (name) => {
    const spinner = ora(`Removing Web AI "${name}"...`).start();

    try {
      await config.removeWebAI(name);
      spinner.succeed(chalk.green(`Web AI "${name}" removed`));
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

webaiCmd
  .command('show <name>')
  .description('Show Web AI details')
  .action((name) => {
    const ai = config.getWebAI(name);

    if (!ai) {
      console.log(chalk.red(`\n✗ Web AI "${name}" not found`));
      process.exit(1);
    }

    console.log(chalk.cyan(`\n🌐 Web AI: ${ai.name}`));
    console.log(chalk.white(`\n  URL: ${ai.url}`));
    if (ai.inputSelector) {
      console.log(chalk.white(`  Input Selector: ${ai.inputSelector}`));
    }
    if (ai.submitSelector) {
      console.log(chalk.white(`  Submit Selector: ${ai.submitSelector}`));
    }
    if (ai.responseSelector) {
      console.log(chalk.white(`  Response Selector: ${ai.responseSelector}`));
    }
    if (ai.responseTimeout) {
      console.log(chalk.white(`  Timeout: ${ai.responseTimeout}ms`));
    }
  });

webaiCmd
  .command('chat <name> <message>')
  .description('Chat with a Web AI service')
  .action(async (name, message) => {
    const spinner = ora(`Chatting with ${name}...`).start();

    try {
      const { webAIService } = await import('@/ai/webai');
      const aiConfig = config.getWebAI(name);

      if (!aiConfig) {
        spinner.fail(chalk.red(`Web AI "${name}" not found`));
        process.exit(1);
      }

      webAIService.addConfig(aiConfig);
      const response = await webAIService.query(name, message);

      spinner.succeed(chalk.green('Response received'));
      console.log(chalk.cyan('\n💬 Response:'));
      console.log(chalk.white(response));

      await webAIService.close();
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

webaiCmd
  .command('login <name>')
  .description('Open browser to login to a Web AI service (session will be saved)')
  .action(async (name) => {
    const spinner = ora(`Opening ${name} for login...`).start();

    try {
      const aiConfig = config.getWebAI(name);

      if (!aiConfig) {
        spinner.fail(chalk.red(`Web AI "${name}" not found`));
        process.exit(1);
      }

      // Use persistent browser data directory
      const browser = new BrowserEngine({
        headless: false,
        userDataDir: process.env.BROWSER_DATA_DIR || '~/.openman/browser',
      });

      await browser.initialize();
      const { page } = await browser.navigate(aiConfig.url);

      spinner.succeed(chalk.green('Browser opened'));
      console.log(chalk.cyan('\n📋 Instructions:'));
      console.log(chalk.white('  1. Login to ' + name + ' in the browser window'));
      console.log(chalk.white('  2. After login, press Enter here to save session'));
      console.log(chalk.gray('\n  (Your login will be saved for future use)\n'));

      // Wait for user to press Enter
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      await new Promise<void>((resolve) => {
        rl.question(chalk.cyan('Press Enter after login... '), () => {
          rl.close();
          resolve();
        });
      });

      await browser.close();
      console.log(chalk.green('\n✓ Session saved! You can now use: openman webai chat ' + name + ' "message"'));
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

// ============================================================================
// Helper Functions
// ============================================================================

async function getUserInput(): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.cyan('> '), (input) => {
      rl.close();
      resolve(input);
    });
  });
}

async function question(rl: any, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer: string) => {
      resolve(answer);
    });
  });
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// Device Commands
// ============================================================================

const deviceCmd = program.command('device').description('Device management commands');

deviceCmd
  .command('list')
  .description('List connected devices')
  .action(async () => {
    const spinner = ora('Scanning for devices...').start();

    try {
      const { deviceTools } = await import('@/tools/device');
      const devices = await deviceTools.listDevices();

      spinner.stop();

      if (devices.length === 0) {
        console.log(chalk.yellow('\nNo devices connected'));
        console.log(chalk.gray('\nConnect a device via USB and enable USB debugging'));
        return;
      }

      console.log(chalk.cyan('\n📱 Connected Devices:'));
      devices.forEach((device, index) => {
        console.log(chalk.white(`\n  ${index + 1}. ${device.model}`));
        console.log(chalk.gray(`     ID: ${device.id}`));
        console.log(chalk.gray(`     Android: ${device.androidVersion}`));
        console.log(chalk.gray(`     Status: ${device.status}`));
      });
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

deviceCmd
  .command('screenshot')
  .description('Take a screenshot from device')
  .option('-d, --device <id>', 'device ID')
  .option('-o, --output <dir>', 'output directory')
  .action(async (options) => {
    const spinner = ora('Taking screenshot...').start();

    try {
      const { deviceTools } = await import('@/tools/device');
      const result = await deviceTools.takeScreenshot({
        deviceId: options.device,
        outputDir: options.output,
      });

      if (result.success && result.data) {
        const data = result.data as { device: string; path: string; size: number };
        spinner.succeed(chalk.green('Screenshot saved'));
        console.log(chalk.cyan('\n📸 Screenshot Info:'));
        console.log(chalk.white(`  Device: ${data.device}`));
        console.log(chalk.white(`  Path: ${data.path}`));
        console.log(chalk.white(`  Size: ${(data.size / 1024).toFixed(1)} KB`));
      } else {
        spinner.fail(chalk.red(result.error || 'Unknown error'));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

deviceCmd
  .command('screen')
  .description('Get device screen info')
  .option('-d, --device <id>', 'device ID')
  .action(async (options) => {
    const spinner = ora('Getting screen info...').start();

    try {
      const { deviceTools } = await import('@/tools/device');
      const result = await deviceTools.getScreenInfo(options.device);

      spinner.stop();

      if (result.success && result.data) {
        const data = result.data as { device: string; resolution: string; density: number; androidVersion: string };
        console.log(chalk.cyan('\n📺 Screen Info:'));
        console.log(chalk.white(`  Device: ${data.device}`));
        console.log(chalk.white(`  Resolution: ${data.resolution}`));
        console.log(chalk.white(`  Density: ${data.density} DPI`));
        console.log(chalk.white(`  Android: ${data.androidVersion}`));
      } else {
        console.log(chalk.red('\n✗ ' + (result.error || 'Unknown error')));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

deviceCmd
  .command('tap <x> <y>')
  .description('Tap on screen at coordinates')
  .option('-d, --device <id>', 'device ID')
  .action(async (x, y, options) => {
    const spinner = ora(`Tapping at (${x}, ${y})...`).start();

    try {
      const { deviceTools } = await import('@/tools/device');
      const result = await deviceTools.tap(parseInt(x), parseInt(y), options.device);

      if (result.success) {
        spinner.succeed(chalk.green('Tap executed'));
      } else {
        spinner.fail(chalk.red(result.error || 'Unknown error'));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

deviceCmd
  .command('input <text>')
  .description('Send text to device')
  .option('-d, --device <id>', 'device ID')
  .action(async (text, options) => {
    const spinner = ora('Sending text...').start();

    try {
      const { deviceTools } = await import('@/tools/device');
      const result = await deviceTools.sendText(text, options.device);

      if (result.success) {
        spinner.succeed(chalk.green('Text sent'));
      } else {
        spinner.fail(chalk.red(result.error || 'Unknown error'));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

deviceCmd
  .command('key <keycode>')
  .description('Press a key (home, back, menu, enter, etc.)')
  .option('-d, --device <id>', 'device ID')
  .action(async (keycode, options) => {
    const spinner = ora(`Pressing ${keycode}...`).start();

    try {
      const { deviceTools } = await import('@/tools/device');
      const result = await deviceTools.pressKey(keycode, options.device);

      if (result.success) {
        spinner.succeed(chalk.green(`Key ${keycode} pressed`));
      } else {
        spinner.fail(chalk.red(result.error || 'Unknown error'));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

// ============================================================================
// Analyze Commands
// ============================================================================

program
  .command('analyze <image>')
  .description('Analyze an image using AI vision')
  .option('-p, --prompt <text>', 'custom analysis prompt')
  .option('--elements', 'find UI elements')
  .option('--suggest [goal]', 'suggest actions')
  .option('-a, --ai <provider>', 'AI provider (openai, webai)', 'openai')
  .option('-w, --webai <name>', 'Web AI name (e.g., doubao, claude)')
  .action(async (image, options) => {
    const spinner = ora('Analyzing image...').start();

    try {
      const provider = options.ai || 'openai';

      if (provider === 'openai') {
        const { imageAnalyzer } = await import('@/ai/vision');

        if (!imageAnalyzer.isAvailable()) {
          spinner.fail(chalk.red('OpenAI API key not configured. Use --ai webai to use Web AI instead.'));
          process.exit(1);
        }

        let result;
        if (options.elements) {
          result = await imageAnalyzer.findUIElements(image);
        } else if (options.suggest !== undefined) {
          result = await imageAnalyzer.suggestActions(image, options.suggest);
        } else {
          result = await imageAnalyzer.analyzeImage(image, options.prompt);
        }

        spinner.succeed(chalk.green('Analysis complete'));

        console.log(chalk.cyan('\n🔍 Analysis Result (OpenAI):'));
        console.log(chalk.white(`\n${result.description}`));

        if (result.elements && result.elements.length > 0) {
          console.log(chalk.cyan('\n📋 UI Elements:'));
          result.elements.forEach((el, i) => {
            console.log(chalk.white(`  ${i + 1}. ${el}`));
          });
        }

        if (result.suggestions && result.suggestions.length > 0) {
          console.log(chalk.cyan('\n💡 Suggestions:'));
          result.suggestions.forEach((s, i) => {
            console.log(chalk.white(`  ${i + 1}. ${s}`));
          });
        }
      } else if (provider === 'webai') {
        const { webAIService } = await import('@/ai/webai');
        const webAIName = options.webai || 'doubao';
        const aiConfig = config.getWebAI(webAIName);

        if (!aiConfig) {
          spinner.fail(chalk.red(`Web AI "${webAIName}" not found. Use: openman webai list`));
          process.exit(1);
        }

        webAIService.addConfig(aiConfig);

        // Build prompt for Web AI
        let prompt = options.prompt || '请分析这张图片，描述你看到的内容';
        if (options.elements) {
          prompt = '请识别这张截图中的所有UI元素（按钮、输入框、图标等）';
        } else if (options.suggest !== undefined) {
          prompt = `请分析这张截图并建议如何操作来实现: ${options.suggest}`;
        }

        // Resolve image path
        const path = await import('path');
        const imagePath = path.resolve(image);

        spinner.text = 'Uploading image and analyzing...';
        const result = await webAIService.queryWithImage(webAIName, imagePath, prompt);

        spinner.succeed(chalk.green('Analysis complete'));
        console.log(chalk.cyan(`\n🔍 Analysis Result (Web AI - ${webAIName}):`));
        console.log(chalk.white(`\n${result}`));

        await webAIService.close();
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

// ============================================================================
// Screenshot & Analyze (Combined Command)
// ============================================================================

program
  .command('capture')
  .description('Take screenshot and analyze it')
  .option('-d, --device <id>', 'device ID')
  .option('-g, --goal <text>', 'analysis goal')
  .option('--no-analyze', 'skip analysis, just capture')
  .option('-a, --ai <provider>', 'AI provider (openai, webai)', 'openai')
  .option('-w, --webai <name>', 'Web AI name (e.g., doubao, claude)')
  .option('--show-browser', 'show browser window for Web AI (to login)')
  .action(async (options) => {
    const spinner = ora('Taking screenshot...').start();

    try {
      const { deviceTools } = await import('@/tools/device');

      // Take screenshot
      const result = await deviceTools.takeScreenshot({
        deviceId: options.device,
      });

      if (!result.success || !result.data) {
        spinner.fail(chalk.red(result.error || 'Screenshot failed'));
        process.exit(1);
      }

      const screenshotData = result.data as { path: string; device: string };
      spinner.succeed(chalk.green('Screenshot captured'));
      console.log(chalk.gray(`  Saved to: ${screenshotData.path}`));

      // Analyze if requested
      if (options.analyze !== false) {
        const provider = options.ai || 'openai';

        if (provider === 'openai') {
          const analyzeSpinner = ora('Analyzing screenshot...').start();

          try {
            const { imageAnalyzer } = await import('@/ai/vision');

            if (!imageAnalyzer.isAvailable()) {
              analyzeSpinner.warn(chalk.yellow('OpenAI API not configured, skipping analysis'));
              console.log(chalk.gray('Set OPENAI_API_KEY or use --ai webai to use Web AI'));
              return;
            }

            const analysis = await imageAnalyzer.suggestActions(screenshotData.path, options.goal);

            analyzeSpinner.succeed(chalk.green('Analysis complete'));

            console.log(chalk.cyan('\n📱 Device: ') + chalk.white(screenshotData.device));
            console.log(chalk.cyan('\n🔍 Screen Analysis (OpenAI):'));
            console.log(chalk.white(`\n${analysis.description}`));

            if (analysis.elements && analysis.elements.length > 0) {
              console.log(chalk.cyan('\n📋 UI Elements:'));
              analysis.elements.slice(0, 10).forEach((el, i) => {
                console.log(chalk.white(`  ${i + 1}. ${el}`));
              });
            }

            if (analysis.suggestions && analysis.suggestions.length > 0) {
              console.log(chalk.cyan('\n💡 Suggested Actions:'));
              analysis.suggestions.forEach((s, i) => {
                console.log(chalk.white(`  ${i + 1}. ${s}`));
              });
            }
          } catch (error: any) {
            analyzeSpinner.fail(chalk.red('Analysis failed: ' + error.message));
          }
        } else if (provider === 'webai') {
          const analyzeSpinner = ora('Analyzing screenshot with Web AI...').start();

          try {
            const { webAIService } = await import('@/ai/webai');
            const webAIName = options.webai || 'doubao';
            const aiConfig = config.getWebAI(webAIName);

            if (!aiConfig) {
              analyzeSpinner.fail(chalk.red(`Web AI "${webAIName}" not found. Use: openman webai list`));
              return;
            }

            webAIService.addConfig(aiConfig);

            const prompt = options.goal
              ? `Please analyze this screenshot and suggest actions to achieve: ${options.goal}`
              : 'Please analyze this screenshot and describe what you see, including all UI elements and actionable items.';

            const analysis = await webAIService.query(webAIName, prompt);

            analyzeSpinner.succeed(chalk.green('Analysis complete'));

            console.log(chalk.cyan('\n📱 Device: ') + chalk.white(screenshotData.device));
            console.log(chalk.cyan(`\n🔍 Screen Analysis (Web AI - ${webAIName}):`));
            console.log(chalk.white(`\n${analysis}`));

            await webAIService.close();
          } catch (error: any) {
            analyzeSpinner.fail(chalk.red('Analysis failed: ' + error.message));
          }
        }
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
    }
  });

// ============================================================================
// Main
// ============================================================================

if (process.argv.length === 2) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
