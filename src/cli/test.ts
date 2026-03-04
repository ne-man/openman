/**
 * Test Runner - 支持 case id 筛选的测试运行器
 */

import { spawn } from 'child_process';
import chalk from 'chalk';
import path from 'path';

interface TestCase {
  id: string;        // case id，如 webai.001
  suite: string;     // 测试套件名，如 webai
  name: string;      // 测试名称
  file: string;      // 测试文件路径
}

// 所有注册的测试用例
const TEST_CASES: TestCase[] = [
  // webai 测试用例
  { id: 'webai.001', suite: 'webai', name: 'load WebAI configurations', file: 'tests/webai.test.ts' },
  { id: 'webai.002', suite: 'webai', name: 'have at least one WebAI channel', file: 'tests/webai.test.ts' },
  { id: 'webai.003', suite: 'webai', name: 'get specific WebAI config', file: 'tests/webai.test.ts' },
  { id: 'webai.004', suite: 'webai', name: 'add config to service', file: 'tests/webai.test.ts' },
  { id: 'webai.005', suite: 'webai', name: 'get available config names', file: 'tests/webai.test.ts' },
  { id: 'webai.006', suite: 'webai', name: 'ensure default configs', file: 'tests/webai.test.ts' },
  { id: 'webai.007', suite: 'webai', name: 'return available channels in order', file: 'tests/webai.test.ts' },
  { id: 'webai.008', suite: 'webai', name: 'have yuanbao config available', file: 'tests/webai.test.ts' },
  { id: 'webai.009', suite: 'webai', name: 'query with yuanbao channel', file: 'tests/webai.test.ts' },
  { id: 'webai.010', suite: 'webai', name: 'handle follow-up with yuanbao', file: 'tests/webai.test.ts' },
  { id: 'webai.011', suite: 'webai', name: 'have test image directory', file: 'tests/webai.test.ts' },
  { id: 'webai.012', suite: 'webai', name: 'find available screenshots', file: 'tests/webai.test.ts' },
  { id: 'webai.013', suite: 'webai', name: 'query with image using yuanbao', file: 'tests/webai.test.ts' },
  { id: 'webai.014', suite: 'webai', name: 'query with image using doubao', file: 'tests/webai.test.ts' },
  { id: 'webai.015', suite: 'webai', name: 'have test code directory', file: 'tests/webai.test.ts' },
  { id: 'webai.016', suite: 'webai', name: 'create sample code file', file: 'tests/webai.test.ts' },
  { id: 'webai.017', suite: 'webai', name: 'analyze code file with yuanbao', file: 'tests/webai.test.ts' },
  { id: 'webai.018', suite: 'webai', name: 'analyze code file with doubao', file: 'tests/webai.test.ts' },
  { id: 'webai.019', suite: 'webai', name: 'throw error for non-existent config', file: 'tests/webai.test.ts' },

  // core 测试用例
  { id: 'core.001', suite: 'core', name: 'load configuration', file: 'tests/core.test.ts' },
  { id: 'core.002', suite: 'core', name: 'get browser config', file: 'tests/core.test.ts' },
  { id: 'core.003', suite: 'core', name: 'assess risk levels', file: 'tests/core.test.ts' },
  { id: 'core.004', suite: 'core', name: 'check permissions', file: 'tests/core.test.ts' },
  { id: 'core.005', suite: 'core', name: 'get system info', file: 'tests/core.test.ts' },
  { id: 'core.006', suite: 'core', name: 'get current tasks', file: 'tests/core.test.ts' },
  { id: 'core.007', suite: 'core', name: 'get task history', file: 'tests/core.test.ts' },
  { id: 'core.008', suite: 'core', name: 'create browser instance', file: 'tests/core.test.ts' },
];

/**
 * 解析 case 参数
 * 支持格式：
 * - webai        -> 运行所有 webai 测试
 * - webai.001    -> 运行指定 case
 * - core         -> 运行所有 core 测试
 */
function parseCaseFilter(caseFilter: string): { suite?: string; caseId?: string } {
  if (caseFilter.includes('.')) {
    const [suite, id] = caseFilter.split('.');
    return { suite, caseId: caseFilter };
  }
  return { suite: caseFilter };
}

/**
 * 获取匹配的测试用例
 */
function getMatchingCases(caseFilter: string): TestCase[] {
  const { suite, caseId } = parseCaseFilter(caseFilter);

  if (caseId) {
    // 精确匹配单个 case
    return TEST_CASES.filter(tc => tc.id === caseId);
  }

  if (suite) {
    // 匹配整个测试套件
    return TEST_CASES.filter(tc => tc.suite === suite);
  }

  return [];
}

/**
 * 列出所有测试用例
 */
export function listTestCases(suite?: string): void {
  const cases = suite ? TEST_CASES.filter(tc => tc.suite === suite) : TEST_CASES;

  console.log(chalk.cyan('\n📋 Available Test Cases:\n'));

  const grouped: Record<string, TestCase[]> = {};
  for (const tc of cases) {
    if (!grouped[tc.suite]) grouped[tc.suite] = [];
    grouped[tc.suite].push(tc);
  }

  for (const [suiteName, suiteCases] of Object.entries(grouped)) {
    console.log(chalk.white(`\n[${suiteName}]`));
    for (const tc of suiteCases) {
      console.log(chalk.gray(`  ${tc.id}: ${tc.name}`));
    }
  }

  console.log(chalk.cyan('\n💡 Usage:'));
  console.log(chalk.white('  ./openman test -case webai          # Run all webai tests'));
  console.log(chalk.white('  ./openman test -case webai.001      # Run specific test'));
  console.log('');
}

/**
 * 运行测试
 */
export async function runTests(caseFilter: string, verbose: boolean = false): Promise<void> {
  const matchedCases = getMatchingCases(caseFilter);

  if (matchedCases.length === 0) {
    console.log(chalk.red(`\n❌ No test cases found for: ${caseFilter}`));
    console.log(chalk.gray('\nAvailable suites: webai, core'));
    console.log(chalk.gray('Use "./openman test -list" to see all cases'));
    return;
  }

  console.log(chalk.cyan('\n🧪 Running Tests\n'));
  console.log(chalk.white(`Filter: ${caseFilter}`));
  console.log(chalk.white(`Matched: ${matchedCases.length} test(s)\n`));

  // 显示匹配的测试用例
  for (const tc of matchedCases) {
    console.log(chalk.gray(`  ${tc.id}: ${tc.name}`));
  }
  console.log('');

  // 获取涉及的测试文件
  const files = [...new Set(matchedCases.map(tc => tc.file))];

  // 构建 vitest 命令参数
  const vitestArgs = [
    'run',
    ...files,
    '--reporter=verbose',
  ];

  // 如果指定了单个 case（如 webai.014），使用精确匹配
  const { caseId } = parseCaseFilter(caseFilter);
  if (caseId) {
    // 使用 case ID 格式匹配，如 [webai.014]
    const pattern = `\\[${caseId}\\]`;
    vitestArgs.push('--testNamePattern');
    vitestArgs.push(pattern);
    console.log(chalk.gray(`Running tests with pattern: ${pattern}\n`));
  }

  console.log(chalk.gray(`Executing: npx vitest ${vitestArgs.join(' ')}\n`));
  console.log(chalk.cyan('─'.repeat(60) + '\n'));

  // 运行 vitest - 需要正确传递参数
  const vitestCmd = ['npx', 'vitest', ...vitestArgs];
  const vitest = spawn(vitestCmd[0], vitestCmd.slice(1), {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  return new Promise((resolve, reject) => {
    vitest.on('close', (code) => {
      console.log(chalk.cyan('\n' + '─'.repeat(60)));
      if (code === 0) {
        console.log(chalk.green('\n✅ All tests passed!\n'));
      } else {
        console.log(chalk.red(`\n❌ Tests failed with code: ${code}\n`));
      }
      resolve();
    });

    vitest.on('error', (err) => {
      console.log(chalk.red(`\n❌ Failed to run tests: ${err.message}\n`));
      reject(err);
    });
  });
}

/**
 * 注册 test 命令到 program
 */
export function registerTestCommand(program: any): void {
  const testCmd = program.command('test').description('Run tests with case id filter');

  testCmd
    .option('-c, --case <caseId>', 'test case id (e.g., webai, webai.001)')
    .option('-l, --list', 'list all available test cases')
    .option('-v, --verbose', 'verbose output')
    .action(async (options: { case?: string; list?: boolean; verbose?: boolean }) => {
      if (options.list) {
        listTestCases(options.case);
        return;
      }

      if (!options.case) {
        console.log(chalk.yellow('\n⚠️  Please specify a test case with -case option'));
        console.log(chalk.gray('\nUsage:'));
        console.log(chalk.white('  ./openman test -case webai          # Run all webai tests'));
        console.log(chalk.white('  ./openman test -case webai.001      # Run specific test'));
        console.log(chalk.white('  ./openman test -list                # List all test cases'));
        console.log('');
        return;
      }

      await runTests(options.case, options.verbose);
    });
}
