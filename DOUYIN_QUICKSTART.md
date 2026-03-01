# OpenMan 刷抖音快速开始

## 快速开始（3 步）

### 1. 准备设备

```bash
# 确保已安装 ADB
adb version

# 连接 Android 设备（启用 USB 调试）
adb devices

# 确保看到设备列表
```

### 2. 配置 Web AI

```bash
# 添加 Web AI 服务
npm run dev webai add doubao https://www.doubao.com/chat/

# 或使用其他 AI
npm run dev webai add claude https://claude.ai
```

### 3. 开始刷抖音

```bash
# 启动 Web AI 聊天
npm run dev chat --webai doubao

# 在聊天中发送指令：
刷抖音
```

## 常用指令示例

```
刷抖音                     # 浏览 10 个视频
刷 20 个视频               # 浏览 20 个视频
刷抖音，点赞，评论         # 浏览并点赞、评论
刷 15 个视频并进行分析     # 浏览 15 个视频并 AI 分析
```

## 观看策略

OpenMan 使用**随机观看策略**模拟人类行为：

- **70% 概率**：看完视频（15-60 秒）
- **30% 概率**：快速浏览（3-15 秒）
- **40% 概率**：点赞（如果启用）
- **20% 概率**：收藏（如果启用）
- **10% 概率**：评论（如果启用）

## 统计信息

浏览完成后会显示：

```
📊 统计:
- 观看: 10 个
- 点赞: 4 个
- 收藏: 2 个
- 评论: 1 条
- 总时长: 65 秒
- 平均: 6.5 秒/视频
```

## 详细文档

查看完整使用指南：[DOUYIN_GUIDE.md](DOUYIN_GUIDE.md)

---

**OpenMan - 让 AI 像人类一样刷抖音** 🎬📱
