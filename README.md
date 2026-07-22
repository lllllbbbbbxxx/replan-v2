# Replan MVP

输入一个带截止日期的大任务，Replan 会用 DeepSeek 将任务拆成可执行步骤，并由本地排期算法安排到未来七天。完成状态仅保存在当前浏览器。

当任务包含 GitHub 仓库链接，或类似“学习 GitHub 上的 hello-agent 项目”的描述时，Replan 会先读取匹配仓库的 README 和目录摘要，再按项目的真实章节与模块生成计划。仓库名称有歧义时，请直接粘贴完整链接。

## 本地运行

1. 打开 `.env.local`，填入你的 DeepSeek API Key：

   ```env
   DEEPSEEK_API_KEY=你的_Key
   DEEPSEEK_MODEL=deepseek-v4-flash
   ```

2. 启动项目：

   ```bash
   npm run dev
   ```

3. 访问 <http://localhost:3000>。

修改环境变量后需要重启开发服务。

## 验证

```bash
npm test
```

测试包含生产构建、页面服务端渲染和七天排期边界检查。
