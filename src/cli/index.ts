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
import type { AIProvider } from '@/types';
import { Logger } from '@/utils/logger';

// Initialize logger first
const logger = Logger.getInstance({ moduleName: 'CLI' });
const log = logger.createModuleLogger('CLI');

// Log startup - location is auto-captured
log.info('OpenMan CLI starting...');

const program = new Command();

// ============================================================================
// Type Safety Helpers
// ============================================================================

function parseProvider(value: string | undefined): AIProvider | undefined {
  if (!value || value === 'auto') return undefined;
  const validProviders: AIProvider[] = ['openai', 'anthropic', 'google', 'custom', 'webai'];
  return validProviders.includes(value as AIProvider) ? (value as AIProvider) : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error occurred';
}

function parseMemoryType(value: string | undefined): 'episodic' | 'semantic' | 'preference' | undefined {
  const validTypes = ['episodic', 'semantic', 'preference'];
  return value && validTypes.includes(value) ? (value as 'episodic' | 'semantic' | 'preference') : undefined;
}

function parseExportFormat(value: string): 'json' | 'txt' {
  return value === 'txt' ? 'txt' : 'json';
}

type PermissionCategory = 'web' | 'local' | 'ai';
type PermissionLevel = 'always' | 'ask' | 'never' | 'explicit';

function parsePermissionCategory(value: string): PermissionCategory | null {
  const validCategories: PermissionCategory[] = ['web', 'local', 'ai'];
  return validCategories.includes(value as PermissionCategory) ? (value as PermissionCategory) : null;
}

function parsePermissionLevel(value: string): PermissionLevel | null {
  const validLevels: PermissionLevel[] = ['always', 'ask', 'never', 'explicit'];
  return validLevels.includes(value as PermissionLevel) ? (value as PermissionLevel) : null;
}

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
    log.info('Chat command invoked');

    try {
      // Show provider status
      const bestProvider = aiService.getBestProvider();
      const hasAPI = aiService.hasAPIProvider();
      log.debug(`Provider status: best=${bestProvider}, hasAPI=${hasAPI}`);

      if (options.verbose) {
        spinner.info(chalk.gray(`API configured: ${hasAPI ? 'Yes' : 'No'}`));
        spinner.info(chalk.gray(`Best provider: ${bestProvider}`));
      }

      // Determine provider
      const provider = parseProvider(options.provider) ?? bestProvider;
      if (!options.provider && !hasAPI) {
        spinner.info(chalk.yellow('No API key configured, using Web AI (browser-based)'));
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
      ], provider);

      spinner.stop();
      console.log(chalk.green('💬 OpenMan: ' + response.content));
      
      const tokenInfo = response.usage?.totalTokens ? `${response.usage.totalTokens} tokens` : 'Web AI';
      console.log(chalk.gray(`\n[${tokenInfo} via ${response.provider}${response.model ? ` (${response.model})` : ''}]`));

      // Close web AI browser if used
      if (response.provider === 'webai') {
        await aiService.closeWebAI();
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      spinner.fail(chalk.red('Error: ' + errorMsg));
      if (errorMsg.includes('Web AI')) {
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
    
    log.info(`Task command: "${taskDescription}"`);
    log.debug(`Options: device=${options.device}, verbose=${options.verbose}`);

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
      
      interface ScreenshotData { path?: string; filename?: string; size?: number; device?: string; deviceId?: string; }
      const screenshotData = screenshotResult.data as ScreenshotData | undefined;
      
      if (!screenshotResult.success || !screenshotData?.path) {
        spinner.fail(chalk.red('Failed to capture screenshot'));
        process.exit(1);
      }

      const screenshotPath = screenshotData.path;
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

      const analysisPrompt = `你是设备自动化测试助手。分析截图返回操作步骤JSON。

任务: ${taskDescription}

返回格式（只返回JSON）:
{
  "current_screen": "界面描述",
  "steps": [
    {"action": "tap", "target": "搜索框", "position": "top-center"},
    {"action": "input", "text": "北京站"},
    {"action": "tap", "target": "搜索/确认按钮", "position": "keyboard-search"},
    {"action": "wait", "seconds": 2}
  ],
  "expected_result": "预期结果"
}

position可选值:
- top-left, top-center, top-right (顶部)
- middle-left, middle-center, middle-right (中部)
- bottom-left, bottom-center, bottom-right (底部)
- keyboard-search (键盘搜索键)
- first-result (第一个搜索结果)

action: tap/input/wait/back(返回键)`;

      const analysis = await webAIService.queryWithImage(webAI.name, screenshotPath, analysisPrompt);
      
      spinner.succeed(chalk.green('Analysis complete'));

      // Parse AI response to extract JSON
      interface TaskStep {
        action: 'tap' | 'input' | 'wait' | 'back' | 'swipe';
        target?: string;
        position?: string;
        text?: string;
        x?: number;
        y?: number;
        startX?: number;
        startY?: number;
        endX?: number;
        endY?: number;
        seconds?: number;
      }

      interface TaskPlan {
        current_screen: string;
        steps: TaskStep[];
        expected_result: string;
      }

      let taskPlan: TaskPlan | null = null;
      try {
        // Try to extract JSON from response - look for JSON code blocks first
        const codeBlockMatch = analysis.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          taskPlan = JSON.parse(codeBlockMatch[1]);
        } else {
          // Fallback: find raw JSON object
          const jsonMatch = analysis.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            taskPlan = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (e) {
        // JSON parsing failed
        console.log(chalk.yellow('\n⚠️ JSON parsing failed'));
        console.log(chalk.gray('Raw response preview: ' + analysis.substring(0, 500)));
      }

      // Display analysis
      console.log(chalk.cyan('\n' + '='.repeat(60)));
      console.log(chalk.cyan('📋 Task Analysis'));
      console.log(chalk.cyan('='.repeat(60)));
      console.log(chalk.white(`\n🎯 Task: ${taskDescription}\n`));
      
      if (taskPlan) {
        console.log(chalk.white(`📱 Current Screen: ${taskPlan.current_screen}`));
        console.log(chalk.white(`\n📝 Steps to execute:`));
        taskPlan.steps?.forEach((step: TaskStep, i: number) => {
          const desc = step.action === 'input' 
            ? `${step.action}: "${step.text}"`
            : `${step.action}: ${step.target} (${step.x}%, ${step.y}%)`;
          console.log(chalk.white(`   ${i + 1}. ${desc}`));
        });
        console.log(chalk.white(`\n✅ Expected: ${taskPlan.expected_result}`));
      } else {
        console.log(chalk.white(analysis));
      }
      console.log(chalk.cyan('\n' + '='.repeat(60)));

      // Auto-execute if we have parsed steps
      if (taskPlan && taskPlan.steps && taskPlan.steps.length > 0) {
        // Get device screen size for coordinate conversion
        const screenInfo = await deviceTools.getScreenInfo(targetDevice.id);
        interface ScreenData { width?: number; height?: number; resolution?: string; }
        const screenData = screenInfo.data as ScreenData | undefined;
        const screenWidth = screenData?.width || 1080;
        const screenHeight = screenData?.height || 2340;

        console.log(chalk.cyan('\n🚀 Auto-executing steps...\n'));

        // Position to coordinate mapping
        const positionToCoords = (pos: string): { x: number; y: number } => {
          const map: Record<string, { x: number; y: number }> = {
            'top-left': { x: 15, y: 8 },
            'top-center': { x: 50, y: 8 },
            'top-right': { x: 85, y: 8 },
            'middle-left': { x: 15, y: 50 },
            'middle-center': { x: 50, y: 50 },
            'middle-right': { x: 85, y: 50 },
            'bottom-left': { x: 15, y: 92 },
            'bottom-center': { x: 50, y: 92 },
            'bottom-right': { x: 85, y: 92 },
            'keyboard-search': { x: 91, y: 58 }, // 键盘右下角搜索键
            'first-result': { x: 50, y: 25 }, // 第一个搜索结果
          };
          return map[pos] || { x: 50, y: 50 };
        };

        for (let i = 0; i < taskPlan.steps.length; i++) {
          const step = taskPlan.steps[i];
          const stepNum = i + 1;

          spinner.start(`Step ${stepNum}/${taskPlan.steps.length}: ${step.action}...`);

          try {
            if (step.action === 'tap') {
              let pctX = 50, pctY = 50;
              
              // Use position description if available
              if (step.position) {
                const coords = positionToCoords(step.position);
                pctX = coords.x;
                pctY = coords.y;
              } else if (step.x !== undefined && step.y !== undefined) {
                pctX = Math.max(0, Math.min(100, Number(step.x) || 50));
                pctY = Math.max(0, Math.min(100, Number(step.y) || 50));
              }
              
              const x = Math.round((pctX / 100) * screenWidth);
              const y = Math.round((pctY / 100) * screenHeight);
              await deviceTools.tap(x, y, targetDevice.id);
              spinner.succeed(chalk.green(`Step ${stepNum}: Tapped (${x},${y}) - ${step.target || step.position}`));
              
            } else if (step.action === 'input' && step.text) {
              // Wait longer for keyboard and input field to be ready
              await new Promise(resolve => setTimeout(resolve, 2000));
              await deviceTools.inputText(targetDevice.id, step.text);
              spinner.succeed(chalk.green(`Step ${stepNum}: Input "${step.text}"`));
              // Wait for input to be fully processed
              await new Promise(resolve => setTimeout(resolve, 1500));
              
            } else if (step.action === 'wait') {
              const secs = step.seconds || 2;
              await new Promise(resolve => setTimeout(resolve, secs * 1000));
              spinner.succeed(chalk.green(`Step ${stepNum}: Waited ${secs}s`));
              
            } else if (step.action === 'back') {
              await deviceTools.pressKey('back', targetDevice.id);
              spinner.succeed(chalk.green(`Step ${stepNum}: Back`));
              
            } else if (step.action === 'swipe') {
              const startX = Math.round(((step.startX ?? 0) / 100) * screenWidth);
              const startY = Math.round(((step.startY ?? 0) / 100) * screenHeight);
              const endX = Math.round(((step.endX ?? 0) / 100) * screenWidth);
              const endY = Math.round(((step.endY ?? 0) / 100) * screenHeight);
              await deviceTools.swipe(targetDevice.id, startX, startY, endX, endY);
              spinner.succeed(chalk.green(`Step ${stepNum}: Swiped`));
            }

            // Wait between steps
            await new Promise(resolve => setTimeout(resolve, 1500));

          } catch (err) {
            spinner.fail(chalk.red(`Step ${stepNum} failed: ${getErrorMessage(err)}`));
          }
        }

        // Take verification screenshot
        console.log('');
        spinner.start('📸 Taking verification screenshot...');
        const verifyScreenshot = await deviceTools.takeScreenshot({ deviceId: targetDevice.id });
        spinner.succeed(chalk.green('Verification screenshot captured'));

        // Analyze result
        const verifyData = verifyScreenshot.data as ScreenshotData | undefined;
        if (verifyData?.path) {
          spinner.start('🤖 Verifying result...');
          const verifyPrompt = `任务: ${taskDescription}
预期结果: ${taskPlan.expected_result}

请分析截图判断任务是否成功。回复JSON格式：
{"success": true/false, "status": "当前界面状态", "reason": "失败原因(如果失败)", "suggestion": "下一步建议"}`;
          
          const verification = await webAIService.queryWithImage(webAI.name, verifyData.path, verifyPrompt);
          spinner.succeed(chalk.green('Verification complete'));
          
          // Parse verification result
          let verifyResult: any = null;
          try {
            const jsonMatch = verification.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              verifyResult = JSON.parse(jsonMatch[0]);
            }
          } catch {
            // Could not parse JSON
          }

          console.log(chalk.cyan('\n' + '='.repeat(60)));
          console.log(chalk.cyan('📊 Task Result'));
          console.log(chalk.cyan('='.repeat(60)));
          
          if (verifyResult?.success) {
            console.log(chalk.green('\n✅ Task completed successfully!'));
            console.log(chalk.white(`Status: ${verifyResult.status}`));
          } else {
            console.log(chalk.yellow('\n⚠️ Task not fully completed'));
            console.log(chalk.white(`Status: ${verifyResult?.status || verification}`));
            
            if (verifyResult?.reason) {
              console.log(chalk.gray(`Reason: ${verifyResult.reason}`));
            }
            
            // Auto problem-solving: Ask AI for solution
            if (verifyResult?.suggestion || verifyResult?.reason) {
              console.log(chalk.cyan('\n🔄 Auto problem-solving...'));
              spinner.start('🤖 Finding solution...');
              
              const solutionPrompt = `任务失败了。
任务: ${taskDescription}
当前状态: ${verifyResult?.status || '未知'}
失败原因: ${verifyResult?.reason || '未知'}

请分析问题并提供解决方案，返回JSON格式的下一步操作：
{"solution": "解决方案说明", "steps": [{"action": "tap/input/back/wait", "target": "目标", "position": "位置", "text": "输入内容"}]}`;

              try {
                const solution = await webAIService.followUp(solutionPrompt);
                spinner.succeed(chalk.green('Solution found'));
                
                // Try to parse and offer to execute
                let solutionPlan: any = null;
                try {
                  const jsonMatch = solution.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    solutionPlan = JSON.parse(jsonMatch[0]);
                  }
                } catch {}

                if (solutionPlan?.solution) {
                  console.log(chalk.cyan('\n💡 AI Solution: ') + solutionPlan.solution);
                }
                
                if (solutionPlan?.steps?.length > 0) {
                  console.log(chalk.yellow('\n📝 Suggested fix steps:'));
                  solutionPlan.steps.forEach((s: any, i: number) => {
                    console.log(chalk.white(`   ${i + 1}. ${s.action}: ${s.target || s.text || s.position}`));
                  });
                }
              } catch (err: any) {
                spinner.fail(chalk.gray('Could not get solution: ' + err.message));
              }
            }
          }
          console.log(chalk.cyan('\n' + '='.repeat(60)));
        }
      } else {
        // No parsed steps, enter interactive mode
        const readline = await import('readline');
        console.log(chalk.yellow('\n⚠️ Could not parse executable steps.'));
        console.log(chalk.gray('💬 Enter follow-up instructions or "exit" to quit.\n'));

        while (true) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const userInput = await new Promise<string>((resolve) => {
            rl.question(chalk.cyan('You > '), (answer) => { rl.close(); resolve(answer.trim()); });
          });

          if (!userInput || userInput.toLowerCase() === 'exit') {
            console.log(chalk.gray('\nTask ended.'));
            break;
          }

          spinner.start('🤖 Processing...');
          try {
            const response = await webAIService.followUp(userInput);
            spinner.succeed(chalk.green('Response received'));
            console.log(chalk.green('\n🤖 AI: ') + response + '\n');
          } catch (error) {
            spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
          }
        }
      }

      await webAIService.close();

    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
      if (options.verbose) {
        console.error(error);
      }
      process.exit(1);
    }
  });

// ============================================================================
// Explore Command - Autonomous App Feature Exploration
// ============================================================================

program
  .command('explore <goal...>')
  .description('Autonomously explore app features and generate product documentation')
  .option('-d, --device <id>', 'specific device ID')
  .option('-t, --timeout <minutes>', 'timeout in minutes (safety limit)', '10')
  .option('-v, --verbose', 'show detailed output')
  .action(async (goal: string[], options: { device?: string; timeout?: string; verbose?: boolean }) => {
    const explorationGoal = goal.join(' ');
    const timeoutMinutes = parseInt(options.timeout || '10');
    const maxSafetySteps = 50; // Safety limit only
    const startTime = Date.now();
    const spinner = ora('Initializing exploration...').start();

    try {
      const { DeviceTools } = await import('@/tools/device');
      const { webAIService } = await import('@/ai/webai');
      const fs = await import('fs/promises');
      const path = await import('path');

      const deviceTools = new DeviceTools();

      // Step 1: Connect device
      spinner.text = '🔍 Detecting connected devices...';
      const devices = await deviceTools.listDevices();
      
      if (devices.length === 0) {
        spinner.fail(chalk.red('No devices connected'));
        process.exit(1);
      }

      let targetDevice = devices[0];
      if (options.device) {
        const found = devices.find(d => d.id === options.device);
        if (found) targetDevice = found;
      }

      spinner.succeed(chalk.green(`Device: ${targetDevice.model} (${targetDevice.id})`));

      // Get screen size
      const screenInfo = await deviceTools.getScreenInfo(targetDevice.id);
      const screenWidth = (screenInfo.data as { width?: number; height?: number })?.width || 1080;
      const screenHeight = (screenInfo.data as { width?: number; height?: number })?.height || 2340;

      // Setup Web AI with multi-channel support
      webAIService.ensureDefaultConfigs();
      const webAIs = config.listWebAIs();
      for (const webAI of webAIs) {
        webAIService.addConfig(webAI);
      }
      const availableChannels = webAIService.getAvailableConfigs();
      console.log(chalk.gray(`   📡 Available channels: ${availableChannels.join(', ')}`));

      // Exploration state
      const explorationLog: Array<{
        step: number;
        action: string;
        observation: string;
        screenshot: string;
      }> = [];

      console.log(chalk.cyan('\n' + '='.repeat(60)));
      console.log(chalk.cyan('🔬 Autonomous Exploration Mode'));
      console.log(chalk.cyan('='.repeat(60)));
      console.log(chalk.white(`\n🎯 Goal: ${explorationGoal}`));
      console.log(chalk.white(`📱 Device: ${targetDevice.model}`));
      console.log(chalk.white(`⏱️ Timeout: ${timeoutMinutes} minutes\n`));

      // Position mapping
      const positionToCoords = (pos: string): { x: number; y: number } => {
        const map: Record<string, { x: number; y: number }> = {
          'top-left': { x: 15, y: 8 }, 'top-center': { x: 50, y: 8 }, 'top-right': { x: 85, y: 8 },
          'middle-left': { x: 15, y: 50 }, 'middle-center': { x: 50, y: 50 }, 'middle-right': { x: 85, y: 50 },
          'bottom-left': { x: 15, y: 92 }, 'bottom-center': { x: 50, y: 92 }, 'bottom-right': { x: 85, y: 92 },
          'search-box': { x: 50, y: 8 }, 'keyboard-search': { x: 91, y: 58 }, 'first-result': { x: 50, y: 25 },
        };
        return map[pos] || { x: 50, y: 50 };
      };

      // Exploration loop - no fixed step limit, AI decides when done
      let step = 0;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;

      while (step < maxSafetySteps) {
        step++;
        
        // Check timeout
        const elapsedMinutes = (Date.now() - startTime) / 60000;
        if (elapsedMinutes >= timeoutMinutes) {
          console.log(chalk.yellow(`\n⏱️ Timeout reached (${timeoutMinutes} min). Generating report...\n`));
          break;
        }

        spinner.start(`📸 Step ${step}: Capturing screen... (${Math.round(elapsedMinutes)}/${timeoutMinutes} min)`);
        
        // Take screenshot
        const screenshotResult = await deviceTools.takeScreenshot({ deviceId: targetDevice.id });
        if (!screenshotResult.success || !(screenshotResult.data as { path?: string })?.path) {
          spinner.warn(chalk.yellow(`Step ${step}: Screenshot failed, retrying...`));
          consecutiveErrors++;
          if (consecutiveErrors >= maxConsecutiveErrors) {
            console.log(chalk.red('\n❌ Too many consecutive errors. Stopping exploration.\n'));
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        consecutiveErrors = 0;
        const screenshotPath = (screenshotResult.data as { path: string }).path;

        // Ask AI what to do next
        spinner.text = `🤖 Step ${step}: AI analyzing...`;
        
        const explorePrompt = step === 1 
          ? `你是APP产品体验专家。目标: ${explorationGoal}

分析截图，返回下一步操作JSON（只返回JSON）:
{"screen":"界面名","obs":"功能观察","action":{"do":"tap/input/swipe/back/done","target":"目标","pos":"位置","text":"输入文本"},"plan":["待探索功能"]}

pos值: top-left/top-center/top-right/middle-left/middle-center/middle-right/bottom-left/bottom-center/bottom-right/search-box/first-result
do=done表示探索完成，可生成报告`
          : `继续探索: ${explorationGoal}

已操作:
${explorationLog.slice(-5).map(l => `${l.step}. ${l.action}: ${l.observation.slice(0, 50)}`).join('\n')}

返回JSON:
{"screen":"界面","obs":"新发现","action":{"do":"tap/input/swipe/back/done","target":"目标","pos":"位置","text":"文本"},"todo":["待做"]}

充分体验后设do=done`;

        let aiResponse = '';
        let usedChannel = '';
        try {
          // Use multi-channel fallback - auto switch when verification needed
          const result = await webAIService.queryWithImageFallback(screenshotPath, explorePrompt);
          aiResponse = result.response;
          usedChannel = result.usedConfig;
          if (usedChannel) {
            spinner.text = `🤖 Step ${step}: Response from ${usedChannel}`;
          }
        } catch (error: any) {
          spinner.warn(chalk.yellow(`Step ${step}: All channels failed - ${error.message?.slice(0, 50)}`));
          consecutiveErrors++;
          if (consecutiveErrors >= maxConsecutiveErrors) {
            console.log(chalk.red('\n❌ Too many AI errors. Generating report with collected data.\n'));
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        consecutiveErrors = 0;
        
        // Parse response
        let actionPlan: any = null;
        try {
          const jsonMatch = aiResponse.match(/\{[\s\S]*?\}(?=\s*$|\s*[^{])/);
          if (jsonMatch) actionPlan = JSON.parse(jsonMatch[0]);
        } catch (e) {
          // Try to find any JSON object
          try {
            const allJson = aiResponse.match(/\{[^{}]*\}/g);
            if (allJson) actionPlan = JSON.parse(allJson[0]);
          } catch (e2) {}
        }

        if (!actionPlan) {
          spinner.info(chalk.gray(`Step ${step}: Free-form response`));
          explorationLog.push({ step, action: 'observe', observation: aiResponse.slice(0, 300), screenshot: screenshotPath });
          // Ask AI to continue with structured response
          continue;
        }

        const screen = actionPlan.screen || actionPlan.current_screen || '界面';
        const obs = actionPlan.obs || actionPlan.observation || '';
        spinner.succeed(chalk.green(`Step ${step}: ${screen}`));
        
        // Log observation
        if (obs) console.log(chalk.gray(`   📍 ${obs}`));

        // Check if done
        const actionDo = actionPlan.action?.do || actionPlan.action?.action || actionPlan.next_action?.action;
        if (actionDo === 'done') {
          explorationLog.push({ step, action: 'done', observation: obs, screenshot: screenshotPath });
          console.log(chalk.green('\n✅ AI determined exploration complete!\n'));
          break;
        }

        // Execute action
        const action = actionPlan.action || actionPlan.next_action || {};
        const actionType = action.do || action.action || 'tap';
        let actionDesc = '';

        try {
          if (actionType === 'tap') {
            const pos = action.pos || action.position || 'middle-center';
            const coords = positionToCoords(pos);
            const x = Math.round((coords.x / 100) * screenWidth);
            const y = Math.round((coords.y / 100) * screenHeight);
            await deviceTools.tap(x, y, targetDevice.id);
            actionDesc = `tap ${action.target || '元素'} (${pos})`;
            console.log(chalk.blue(`   👆 Tap: ${action.target || pos}`));
          } else if (actionType === 'input') {
            const text = action.text || '';
            await deviceTools.inputText(text, targetDevice.id);
            actionDesc = `input "${text}"`;
            console.log(chalk.blue(`   ⌨️ Input: ${text}`));
          } else if (actionType === 'swipe') {
            const dir = action.direction || 'up';
            if (dir === 'up') {
              await deviceTools.swipe(targetDevice.id, Math.round(screenWidth / 2), Math.round(screenHeight * 0.7), Math.round(screenWidth / 2), Math.round(screenHeight * 0.3));
            } else if (dir === 'down') {
              await deviceTools.swipe(targetDevice.id, Math.round(screenWidth / 2), Math.round(screenHeight * 0.3), Math.round(screenWidth / 2), Math.round(screenHeight * 0.7));
            }
            actionDesc = `swipe ${dir}`;
            console.log(chalk.blue(`   👆 Swipe ${dir}`));
          } else if (actionType === 'back') {
            await deviceTools.pressKey('KEYCODE_BACK', targetDevice.id);
            actionDesc = 'back';
            console.log(chalk.blue(`   ⬅️ Back`));
          }
        } catch (actionError: any) {
          spinner.warn(chalk.yellow(`Action failed: ${actionError.message?.slice(0, 30)}`));
          actionDesc = `failed: ${actionType}`;
        }

        explorationLog.push({ step, action: actionDesc, observation: obs, screenshot: screenshotPath });

        // Wait for UI to settle
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      if (step >= maxSafetySteps) {
        console.log(chalk.yellow(`\n⚠️ Safety limit reached (${maxSafetySteps} steps). Generating report...\n`));
      }

      // Generate product documentation
      console.log(chalk.cyan('\n' + '='.repeat(60)));
      console.log(chalk.cyan('📝 Generating Product Documentation...'));
      console.log(chalk.cyan('='.repeat(60)));

      spinner.start('🤖 AI generating documentation based on exploration...');

      const docPrompt = `基于以下APP探索记录，生成产品说明文档。

探索目标: ${explorationGoal}
设备: ${targetDevice.model}

探索记录:
${explorationLog.map(l => `Step ${l.step}: ${l.action}
观察: ${l.observation}`).join('\n\n')}

请输出完整的产品说明文档，包括:
1. 功能概述
2. 界面布局与设计
3. 核心功能点（基于实际操作体验）
4. 交互流程
5. 用户体验评价
6. 改进建议`;

      const documentation = await webAIService.followUp(docPrompt);
      
      spinner.succeed(chalk.green('Documentation generated'));

      console.log(chalk.cyan('\n📋 Product Documentation:\n'));
      console.log(chalk.white(documentation));

      // Save documentation
      const docPath = path.join(process.env.HOME || '~', '.openman', 'docs', `explore-${Date.now()}.md`);
      await fs.mkdir(path.dirname(docPath), { recursive: true });
      await fs.writeFile(docPath, `# ${explorationGoal}\n\n${documentation}`);
      console.log(chalk.gray(`\n📁 Saved to: ${docPath}`));

      await webAIService.close();

    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
      if (options.verbose) console.error(error);
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
        memories = memorySystem.getRecentMemories(parseInt(options.limit), parseMemoryType(options.type));
      } else {
        memories = await memorySystem.queryMemories({
          type: parseMemoryType(options.type),
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
      const provider = parseProvider(options.provider) ?? 'openai';
      const session = await sessionManager.createSession(name, provider, options.model);

      spinner.succeed(chalk.green('Session created'));
      console.log(chalk.cyan(`\nSession ID: ${session.id}`));
      console.log(chalk.white(`Name: ${session.name}`));
      console.log(chalk.white(`Provider: ${session.provider}`));
      console.log(chalk.white(`Model: ${session.model}`));
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
      const format = parseExportFormat(options.format);
      const content = await sessionManager.exportSession(id, format);

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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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

    const parsedCategory = parsePermissionCategory(category);
    const parsedPermission = parsePermissionLevel(permission);

    if (!parsedCategory || !parsedPermission) {
      console.log(chalk.red('\n✗ Invalid category or permission'));
      process.exit(1);
    }

    permissionManager.setPermission(
      parsedCategory,
      action,
      parsedPermission
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
    displayLogs.forEach((log) => {
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
      process.exit(1);
    }
  });

webaiCmd
  .command('list')
  .description('List all Web AI services')
  .action(async () => {
    await config.ensureInitialized();
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
      await config.ensureInitialized();
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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

async function question(rl: { question: (query: string, callback: (answer: string) => void) => void }, query: string): Promise<string> {
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
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
          } catch (error) {
            analyzeSpinner.fail(chalk.red('Analysis failed: ' + getErrorMessage(error)));
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
          } catch (error) {
            analyzeSpinner.fail(chalk.red('Analysis failed: ' + getErrorMessage(error)));
          }
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Error: ' + getErrorMessage(error)));
      process.exit(1);
    }
  });

// ============================================================================
// Tool Commands - Local tool cache and management
// ============================================================================

const toolCmd = program.command('tool').description('Manage local tools (create, run, share)');

toolCmd
  .command('list')
  .description('List all local tools')
  .action(async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { homedir } = await import('os');
    
    const toolsDir = path.join(homedir(), '.openman', 'tools');
    
    try {
      await fs.mkdir(toolsDir, { recursive: true });
      const files = await fs.readdir(toolsDir);
      const tools = files.filter(f => f.endsWith('.json'));
      
      if (tools.length === 0) {
        console.log(chalk.yellow('\nNo local tools found.'));
        console.log(chalk.gray('Create one with: openman tool create <name>'));
        return;
      }
      
      console.log(chalk.cyan('\n🔧 Local Tools:\n'));
      for (const toolFile of tools) {
        const toolPath = path.join(toolsDir, toolFile);
        const content = await fs.readFile(toolPath, 'utf-8');
        const tool = JSON.parse(content);
        console.log(chalk.white(`  ${tool.name}`));
        console.log(chalk.gray(`    ${tool.description || 'No description'}`));
        console.log(chalk.gray(`    Created: ${tool.created || 'Unknown'}`));
        console.log('');
      }
    } catch (error: any) {
      console.log(chalk.red('Error: ' + error.message));
    }
  });

toolCmd
  .command('create <name>')
  .description('Create a new local tool')
  .option('-d, --description <text>', 'tool description')
  .action(async (name: string, options: { description?: string }) => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { homedir } = await import('os');
    const readline = await import('readline');
    
    const toolsDir = path.join(homedir(), '.openman', 'tools');
    await fs.mkdir(toolsDir, { recursive: true });
    
    const toolPath = path.join(toolsDir, `${name}.json`);
    
    console.log(chalk.cyan(`\n🔧 Creating tool: ${name}\n`));
    console.log(chalk.gray('Enter the steps for this tool (JSON array format):'));
    console.log(chalk.gray('Example: [{"action":"tap","position":"top-center"},{"action":"input","text":"test"}]'));
    console.log(chalk.gray('Or enter steps interactively:\n'));
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const steps: any[] = [];
    let addingSteps = true;
    
    while (addingSteps) {
      const action = await new Promise<string>(resolve => {
        rl.question(chalk.cyan('Action (tap/input/wait/back/done): '), resolve);
      });
      
      if (action === 'done' || !action) {
        addingSteps = false;
        break;
      }
      
      const step: any = { action };
      
      if (action === 'tap') {
        step.position = await new Promise<string>(resolve => {
          rl.question(chalk.gray('Position (e.g., top-center, middle-left): '), resolve);
        });
        step.target = await new Promise<string>(resolve => {
          rl.question(chalk.gray('Target description: '), resolve);
        });
      } else if (action === 'input') {
        step.text = await new Promise<string>(resolve => {
          rl.question(chalk.gray('Text to input: '), resolve);
        });
      } else if (action === 'wait') {
        const secs = await new Promise<string>(resolve => {
          rl.question(chalk.gray('Seconds to wait: '), resolve);
        });
        step.seconds = parseInt(secs) || 2;
      }
      
      steps.push(step);
      console.log(chalk.green(`  ✓ Added step: ${action}`));
    }
    
    rl.close();
    
    const tool = {
      name,
      description: options.description || `Local tool: ${name}`,
      steps,
      created: new Date().toISOString(),
    };
    
    await fs.writeFile(toolPath, JSON.stringify(tool, null, 2));
    console.log(chalk.green(`\n✓ Tool "${name}" created with ${steps.length} steps`));
    console.log(chalk.gray(`  Saved to: ${toolPath}`));
    console.log(chalk.gray(`  Run with: openman tool run ${name}`));
  });

toolCmd
  .command('run <name>')
  .description('Run a local tool')
  .option('-d, --device <id>', 'device ID')
  .action(async (name: string, options: { device?: string }) => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { homedir } = await import('os');
    const { DeviceTools } = await import('@/tools/device');
    
    const spinner = ora(`Running tool: ${name}...`).start();
    
    try {
      const toolsDir = path.join(homedir(), '.openman', 'tools');
      const toolPath = path.join(toolsDir, `${name}.json`);
      
      const content = await fs.readFile(toolPath, 'utf-8');
      const tool = JSON.parse(content);
      
      const deviceTools = new DeviceTools();
      const devices = await deviceTools.listDevices();
      
      if (devices.length === 0) {
        spinner.fail(chalk.red('No devices connected'));
        return;
      }
      
      const device = options.device 
        ? devices.find(d => d.id === options.device) 
        : devices[0];
      
      if (!device) {
        spinner.fail(chalk.red('Device not found'));
        return;
      }
      
      const screenInfo = await deviceTools.getScreenInfo(device.id);
      const screenWidth = (screenInfo.data as { width?: number; height?: number })?.width || 1080;
      const screenHeight = (screenInfo.data as { width?: number; height?: number })?.height || 2340;
      
      spinner.succeed(chalk.green(`Running tool "${tool.name}" on ${device.model}`));
      console.log(chalk.gray(`  ${tool.description}\n`));
      
      // Position mapping
      const positionToCoords = (pos: string): { x: number; y: number } => {
        const map: Record<string, { x: number; y: number }> = {
          'top-left': { x: 15, y: 8 }, 'top-center': { x: 50, y: 8 }, 'top-right': { x: 85, y: 8 },
          'middle-left': { x: 15, y: 50 }, 'middle-center': { x: 50, y: 50 }, 'middle-right': { x: 85, y: 50 },
          'bottom-left': { x: 15, y: 92 }, 'bottom-center': { x: 50, y: 92 }, 'bottom-right': { x: 85, y: 92 },
          'keyboard-search': { x: 91, y: 58 }, 'first-result': { x: 50, y: 25 },
        };
        return map[pos] || { x: 50, y: 50 };
      };
      
      for (let i = 0; i < tool.steps.length; i++) {
        const step = tool.steps[i];
        const stepSpinner = ora(`Step ${i + 1}/${tool.steps.length}: ${step.action}...`).start();
        
        try {
          if (step.action === 'tap') {
            const coords = positionToCoords(step.position || 'middle-center');
            const x = Math.round((coords.x / 100) * screenWidth);
            const y = Math.round((coords.y / 100) * screenHeight);
            await deviceTools.tap(x, y, device.id);
            stepSpinner.succeed(chalk.green(`Step ${i + 1}: Tap ${step.target || step.position}`));
          } else if (step.action === 'input') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await deviceTools.inputText(device.id, step.text);
            stepSpinner.succeed(chalk.green(`Step ${i + 1}: Input "${step.text}"`));
          } else if (step.action === 'wait') {
            await new Promise(resolve => setTimeout(resolve, (step.seconds || 2) * 1000));
            stepSpinner.succeed(chalk.green(`Step ${i + 1}: Wait ${step.seconds}s`));
          } else if (step.action === 'back') {
            await deviceTools.pressKey('back', device.id);
            stepSpinner.succeed(chalk.green(`Step ${i + 1}: Back`));
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err: any) {
          stepSpinner.fail(chalk.red(`Step ${i + 1} failed: ${err.message}`));
        }
      }
      
      console.log(chalk.green('\n✓ Tool execution complete'));
      
    } catch (error: any) {
      spinner.fail(chalk.red('Error: ' + error.message));
    }
  });

toolCmd
  .command('delete <name>')
  .description('Delete a local tool')
  .action(async (name: string) => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { homedir } = await import('os');
    
    const toolPath = path.join(homedir(), '.openman', 'tools', `${name}.json`);
    
    try {
      await fs.unlink(toolPath);
      console.log(chalk.green(`✓ Tool "${name}" deleted`));
    } catch (error: any) {
      console.log(chalk.red(`Error: Tool "${name}" not found`));
    }
  });

toolCmd
  .command('export <name>')
  .description('Export a tool for sharing')
  .action(async (name: string) => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { homedir } = await import('os');
    
    const toolPath = path.join(homedir(), '.openman', 'tools', `${name}.json`);
    
    try {
      const content = await fs.readFile(toolPath, 'utf-8');
      console.log(chalk.cyan(`\n📤 Export tool "${name}":\n`));
      console.log(content);
      console.log(chalk.gray('\nCopy the JSON above to share this tool.'));
    } catch (error: any) {
      console.log(chalk.red(`Error: Tool "${name}" not found`));
    }
  });

toolCmd
  .command('import')
  .description('Import a tool from JSON')
  .action(async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { homedir } = await import('os');
    const readline = await import('readline');
    
    console.log(chalk.cyan('\n📥 Import tool'));
    console.log(chalk.gray('Paste the tool JSON and press Enter twice:\n'));
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    let jsonInput = '';
    rl.on('line', (line) => {
      if (line === '' && jsonInput.includes('}')) {
        rl.close();
      } else {
        jsonInput += line + '\n';
      }
    });
    
    rl.on('close', async () => {
      try {
        const tool = JSON.parse(jsonInput.trim());
        if (!tool.name) {
          console.log(chalk.red('Error: Tool must have a name'));
          return;
        }
        
        const toolsDir = path.join(homedir(), '.openman', 'tools');
        await fs.mkdir(toolsDir, { recursive: true });
        
        const toolPath = path.join(toolsDir, `${tool.name}.json`);
        await fs.writeFile(toolPath, JSON.stringify(tool, null, 2));
        
        console.log(chalk.green(`\n✓ Tool "${tool.name}" imported`));
        console.log(chalk.gray(`  Run with: openman tool run ${tool.name}`));
      } catch (error: any) {
        console.log(chalk.red('Error: Invalid JSON - ' + error.message));
      }
    });
  });

// ============================================================================
// Main
// ============================================================================

if (process.argv.length === 2) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
