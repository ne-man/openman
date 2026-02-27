/**
 * OpenMan CLI Interface
 */

#!/usr/bin/env node

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
  .description('Chat with OpenMan')
  .option('-v, --verbose', 'verbose output')
  .option('-p, --provider <provider>', 'AI provider to use', 'openai')
  .action(async (message, options) => {
    const spinner = ora('Initializing OpenMan...').start();

    try {
      const input = message ? message.join(' ') : await getUserInput();
      spinner.stop();

      console.log(chalk.cyan('\n🤖 OpenMan: ' + input + '\n'));

      const response = await aiService.completion([
        {
          role: 'system',
          content: 'You are OpenMan, a helpful AI assistant with web browsing, AI services, and local tools capabilities. Be helpful, concise, and practical.',
        },
        {
          role: 'user',
          content: input,
        },
      ], options.provider as any);

      console.log(chalk.green(response.content));
      console.log(chalk.gray(`\n[Used ${response.usage?.totalTokens || 0} tokens via ${response.provider}]`));
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      process.exit(1);
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

      const snapshot = await browser.navigate(url);
      spinner.succeed(chalk.green('Navigation complete'));

      console.log(chalk.cyan('\n📄 Page Information:'));
      console.log(chalk.white(`  Title: ${snapshot.title}`));
      console.log(chalk.white(`  URL: ${snapshot.url}`));
      console.log(chalk.white(`  Text length: ${snapshot.text?.length || 0} characters`));

      if (options.screenshot) {
        const page = await browser.newPage();
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
// Configuration Commands
// ============================================================================

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const configData = config.getAll();

    console.log(chalk.cyan('\n⚙️  Configuration:'));
    console.log(JSON.stringify(configData, null, 2));
  });

program
  .command('permissions')
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

// ============================================================================
// System Commands
// ============================================================================

program
  .command('logs [action]')
  .description('View audit logs')
  .option('-a, --action <action>', 'filter by action')
  .option('-r, --risk <level>', 'filter by risk level')
  .action(async (action, options) => {
    let logs;

    if (options.action) {
      logs = await auditLogger.searchLogs(options.action);
    } else if (options.risk) {
      logs = await auditLogger.searchLogs(undefined, options.risk);
    } else {
      logs = await auditLogger.getLogs();
    }

    console.log(chalk.cyan('\n📝 Audit Logs:'));
    logs.slice(-10).forEach((log: any) => {
      const status = log.result === 'success' ? '✓' : '✗';
      const color = log.result === 'success' ? 'green' : 'red';
      console.log(chalk[color(`\n  ${status} ${log.timestamp}`));
      console.log(chalk.white(`     ${log.action}`));
    });
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

// ============================================================================
// Main
// ============================================================================

if (process.argv.length === 2) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
