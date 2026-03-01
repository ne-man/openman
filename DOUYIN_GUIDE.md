# OpenMan 抖音浏览功能指南

## 概述

OpenMan 现在支持通过 Web AI 聊天界面控制 USB 连接的 Android 设备上的抖音 App！OpenMan 会像人类一样浏览视频，支持随机观看策略、智能点赞、收藏、评论，并可以使用 AI 分析视频内容。

## 功能特性

### 🎯 核心功能

- 📱 **USB 设备控制**：通过 ADB 控制 Android 设备上的抖音 App
- ⏱️ **随机观看策略**：
  - 每个视频随机观看 3-15 秒
  - 70% 概率看完视频（15-60 秒）
  - 30% 概率快速浏览（3-15 秒）
- 💖 **智能互动**：
  - 随机点赞（40% 概率）
  - 随机收藏（20% 概率）
  - 随机评论（10% 概率）
- 🤖 **AI 分析**：可选的 AI 视频内容分析（截图上传到 Web AI）
- 📊 **详细统计**：观看数、点赞数、收藏数、评论数、观看时长等

## 使用方法

### 通过 Web AI 聊天界面使用

OpenMan 集成了 Web AI 服务，你可以通过聊天界面发送指令来控制抖音浏览。

#### 1. 配置 Web AI（如果还没有配置）

```bash
# 添加一个 Web AI 服务
npm run dev webai add doubao https://www.doubao.com/chat/

# 查看已配置的 Web AI
npm run dev webai list
```

#### 2. 启动 Web AI 聊天

```bash
# 使用 doubao 作为 AI 服务
npm run dev chat --webai doubao
```

#### 3. 发送抖音浏览指令

在聊天界面中，你可以发送以下指令：

```
# 基本指令 - 浏览 10 个视频
刷抖音

# 指定数量
刷 20 个视频
浏览 15 个抖音视频

# 带选项的指令
刷抖音，点赞，收藏
刷 10 个视频，点赞，评论，AI分析
浏览 30 个抖音视频并进行分析

# 自然语言指令
帮我看 20 个抖音视频并点赞
我想刷一会儿抖音，大概 15 个视频就行
```

#### 4. 支持的关键词

- **视频数量**：数字 + "个"、"条"、"视频"
- **点赞**："点赞"、"喜欢"
- **收藏**："收藏"、"保存"
- **评论**："评论"
- **AI 分析**："分析"、"AI"、"智能"

### 使用示例

#### 示例 1：基本浏览

```
用户: 刷抖音

OpenMan: 🎭 检测到抖音浏览指令
        📊 配置: 10 个视频, 点赞: false, 评论: false, 收藏: false, AI分析: false
        📱 正在打开抖音 App...

        [浏览过程...]

        ✅ 已完成浏览抖音 10 个视频！

        📊 统计:
        - 观看: 10 个
        - 点赞: 4 个
        - 收藏: 2 个
        - 评论: 1 条
        - 总时长: 65 秒
        - 平均: 6.5 秒/视频
```

#### 示例 2：带点赞和评论

```
用户: 刷 15 个视频，点赞，评论

OpenMan: [自动启动抖音并浏览]
        [随机点赞和评论视频]
        [返回统计信息]
```

#### 示例 3：带 AI 分析

```
用户: 刷 10 个抖音视频并进行分析

OpenMan: [自动启动抖音]
        [每个视频截图并上传到 AI 分析]
        [返回统计信息和 AI 分析结果]
```

## 工作原理

### 1. 指令识别

当你在 Web AI 聊天中发送消息时，OpenMan 会检测是否包含抖音相关关键词：
- "刷抖音"、"浏览抖音"、"douyin"、"tiktok"、"刷视频"

### 2. 参数解析

自动从你的指令中提取参数：
- 视频数量：从 "10 个视频"、"20 条" 等提取
- 互动选项：从 "点赞"、"收藏"、"评论"、"分析" 等提取

### 3. 设备控制

- 通过 ADB 连接 USB 设备
- 自动打开抖音 App
- 控制设备进行操作

### 4. 随机观看策略

```
对于每个视频：
- 70% 概率：看完视频（15-60 秒随机时长）
- 30% 概率：快速浏览（3-15 秒随机时长）
- 40% 概率：点赞
- 20% 概率：收藏
- 10% 概率：评论
```

### 5. 互动操作

- **点赞**：点击屏幕右下角点赞按钮
- **收藏**：点击点赞按钮下方的收藏按钮
- **评论**：点击评论区，输入随机评论，发送
- **滑动**：从屏幕底部向上滑动到下一个视频

### 6. AI 分析（可选）

如果启用 AI 分析：
- 每个视频截图
- 上传截图到 Web AI
- 请求 AI 分析：视频内容、作者信息、点赞数、评论数、建议评论
- 显示 AI 分析结果

## 统计信息

浏览完成后，OpenMan 会显示以下统计：

```
📊 浏览统计:
   观看视频: 10 个
   点赞: 4 个
   收藏: 2 个
   评论: 1 条
   总观看时间: 65 秒
   平均每个视频: 6.5 秒
   AI 分析: 10 次
```

## 环境准备

### 1. 安装 ADB（Android Debug Bridge）

```bash
# macOS (使用 Homebrew)
brew install android-platform-tools

# Linux (Ubuntu/Debian)
sudo apt install android-tools-adb

# Windows
# 下载 Android SDK Platform Tools
# https://developer.android.com/tools/releases/platform-tools
```

### 2. 连接 Android 设备

1. 在 Android 设备上启用 **开发者选项**
2. 启用 **USB 调试**
3. 用 USB 线连接设备到电脑
4. 在设备上允许 USB 调试授权

### 3. 验证连接

```bash
# 检查设备是否连接
adb devices

# 应该看到类似输出：
# List of devices attached
# XXXXXXXXXXXX    device
```

### 4. 打开抖音 App

在设备上手动打开抖音 App，或者在浏览时让 OpenMan 自动打开。

## 技术实现

### 架构

```
用户发送指令
    ↓
Web AI 聊天界面
    ↓
检测"刷抖音"关键词
    ↓
USBDeviceDouyin 控制器
    ↓
ADB 控制设备
    ↓
抖音 App 操作
    ↓
返回统计结果
```

### 核心文件

- `src/browser/usb-douyin.ts` - USB 设备抖音控制器
- `src/ai/webai.ts` - Web AI 服务（包含指令检测）

### API 使用

```typescript
import { USBDeviceDouyin } from './src/browser/usb-douyin';

const controller = new USBDeviceDouyin({
  deviceId: 'your-device-id', // 可选，自动检测
  watchDuration: { min: 3, max: 15 },
  autoLike: true,
  autoCollect: true,
  autoComment: true,
  likeProbability: 0.4,
  commentProbability: 0.1,
  collectProbability: 0.2,
  watchUntilEnd: true,
  analyzeWithAI: true,
  webAIName: 'doubao',
});

await controller.openDouyin();
const stats = await controller.browse(10);
await controller.close();
```

## 注意事项

⚠️ **重要提示**：

1. **设备连接**：确保 Android 设备已通过 USB 连接并启用 USB 调试
2. **ADB 访问**：首次连接时需要在设备上授权 ADB 访问
3. **抖音 App**：确保抖音 App 已安装并可以正常使用
4. **网络连接**：确保设备和电脑都有网络连接
5. **屏幕状态**：保持设备屏幕亮起
6. **合理使用**：
   - 不要过度刷视频，避免触发平台的异常检测
   - 遵守抖音的使用条款
   - 注意保护账号安全
7. **AI 分析**：如果启用 AI 分析，需要配置 Web AI 服务

## 故障排除

### 问题 1：找不到设备

```bash
# 检查 ADB 是否安装
adb version

# 检查设备连接
adb devices

# 如果没有设备，尝试：
adb kill-server
adb start-server
adb devices
```

### 问题 2：无法打开抖音

- 手动在设备上打开抖音 App
- 检查抖音是否安装
- 确认设备没有其他 App 占用前台

### 问题 3：操作不准确

- 不同设备屏幕尺寸可能导致点击位置不准确
- 可能需要调整 `USBDeviceDouyin` 中的坐标比例

### 问题 4：AI 分析失败

- 确保已配置 Web AI 服务
- 检查网络连接
- 确认 Web AI 服务可用

## 未来增强

- 📋 支持更多 Android 设备品牌和分辨率
- 🔍 内容过滤（基于关键词、类别、作者等）
- 📦 导出浏览记录和分析结果
- 🎨 自定义评论模板
- 📊 更详细的数据分析报告
- 🎯 智能推荐（基于 AI 分析推荐相似内容）

## License

MIT License - 详见 [LICENSE](LICENSE)

---

**OpenMan - 让 AI 像人类一样浏览互联网** 🤖

**注意**：此功能仅供学习和研究使用，请遵守相关平台的使用条款和法律法规。
