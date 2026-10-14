# Minus 项目结构与数据流

本文档说明当前代码库的目录结构、页面职责、状态划分与核心数据流。

## 1. 目录结构

```text
src/
├─ app/
│  ├─ page.tsx                         # / → 重定向至 /chat
│  ├─ (app)/
│  │  ├─ layout.tsx                    # AppShell 主布局
│  │  ├─ chat/page.tsx                 # 主对话页 (HomeChat)
│  │  ├─ course/[id]/page.tsx          # 课程与章节学习页
│  │  ├─ library/page.tsx              # 本地资料库
│  │  ├─ calendar/page.tsx             # 学习日历
│  │  ├─ history/page.tsx              # 历史会话与课程记录
│  │  └─ video/page.tsx                # 视频元数据页（实验性）
│  └─ api/
│     ├─ chat/                         # 流式对话与会话管理
│     ├─ agents/run/                   # 学习流程编排接口
│     ├─ agent/                        # 本地工具调用与人工确认（HITL）
│     ├─ learning/                     # 课程、资料与日历持久化接口
│     ├─ memory/                       # 记忆提取与检索
│     └─ settings/                     # Skills、自动化、审计与配置接口
├─ components/
│  ├─ chat/                            # 主对话与建课卡片组件
│  ├─ layout/                          # AppShell 与侧边栏导航
│  ├─ learning/                        # 课程与资料库组件
│  ├─ providers/                       # 主题与客户端状态恢复
│  ├─ settings/                        # 设置面板组件
│  ├─ ui/                              # 基础通用 UI 组件
│  ├─ agent/                           # 工具执行状态组件
│  └─ monitor/                         # 旧版监控面板组件（未挂载）
├─ lib/
│  ├─ agents/                          # 学习编排与结构化协议解析
│  ├─ agent/                           # 工具执行循环、权限策略与 HITL
│  ├─ chat/                            # 对话辅助与错误恢复
│  ├─ learning/                        # 本地存储仓库、课纲规划与课程会话
│  ├─ automation/                      # 应用内定时与事件触发器
│  ├─ config/                          # 用户配置文件读写（UserConfigurationV1）
│  ├─ memory/
│  ├─ migration/
│  ├─ navigation/
│  ├─ tools/
│  ├─ sandbox/
│  └─ llm/
├─ store/
│  ├─ chat-store.ts
│  ├─ learn-flow-store.ts
│  ├─ learning-store.ts
│  ├─ settings-store.ts
│  ├─ ui-store.ts
│  └─ agent-store.ts
└─ types/
```

## 2. 主要页面模块

### Home / Chat (`src/components/chat/home-chat.tsx`)

应用的主入口组件，负责：

- 多轮流式对话（SSE）、消息编辑与重新生成；
- 学习意图识别、目标澄清卡片与课纲草稿编辑卡片；
- 本地工具调用状态展示与高风险操作确认（HITL）；
- 从对话发起日历计划调整。

### Course (`/course/[id]`)

根据 `course` 与 `session` 参数加载课程内容。课程仅在用户确认大纲后创建，编辑大纲草稿本身不会写入课程数据。章节讲解支持引用本地资料库文档或可选的网页检索结果。

### Settings

- `Skills`：加载 `skills/*.md` 内置规则，用户自定义修改保存在本地覆盖配置中。
- `Playbook`：管理提示词模板、可用工具与步骤参数。
- `自动化`：在应用运行期间按定时或学习事件触发任务，包含防重复执行与有限次重试。
- `审计`：配置本地操作审计日志的保留周期与脱敏策略。

### Library (`/library`)

管理本地文档、文件夹、全文检索与导入记录，支持将资料关联到具体课程。

### Calendar (`/calendar`)

包含月历视图、今日任务、待确认日程草案以及日历助手对话。AI 提出的排期或调整建议均先生成预览草案，需用户确认后才正式写入日历。

### History (`/history`)

按普通对话与课程学习分类展示历史记录，支持恢复历史对话或继续已有课程章节。

## 3. 客户端状态划分

| Store | 负责维护的数据 |
|---|---|
| `chat-store` | 会话列表、消息记录、当前生成流状态与本地持久化迁移 |
| `learn-flow-store` | 各会话对应的建课阶段、澄清/大纲卡片与工具执行事件 |
| `learning-store` | 课程、资料、任务、日历与学习进度前端缓存 |
| `settings-store` | 模型供应商选择、安全策略与界面偏好（不存储明文 API Key） |
| `ui-store` | 当前激活视图、侧边栏折叠状态与设置弹窗状态 |
| `agent-store` | 旧版工具面板状态 |

页面路由以 URL 为准，`StoreHydrationGate` 在挂载主界面前同步恢复客户端持久化状态，避免首屏闪烁。

## 4. 核心数据流

### 普通对话

```text
HomeChat → POST /api/chat → SSE 流式更新当前回复 → 可选记忆提取
```

### 深入学习建课

```text
表达学习意图 → 目标澄清 → 生成可编辑大纲 → 用户确认开始学习
  → createCourse → createLearningPathFromOutline → createSession
  → 跳转 /course/<id>?s=<sessionId>
```

### 本地工具与安全确认（HITL）

```text
触发工具调用 → 权限策略检查 → 默认在沙箱中执行
  → 若涉及高风险操作则暂停 (pending_tool_confirm)
  → 用户确认允许或拒绝 → 恢复或终止执行
```

### 学习日历调整

```text
输入日程调整需求 → 生成结构化排期草案 → 预览与手动微调 → 确认写入日历
```

## 5. 本地存储与安全机制

- 课程、资料与日历数据存储在本地 JSON 仓库中，写入时使用临时文件与原子重命名防止文件损坏。
- 用户配置保存在 `~/.minus/data/user-configuration.json`；导出数据包备份时自动排除 API Key 与审计日志。
- 模型 API Key 仅在服务端读取与使用，不下发至浏览器本地存储。
- 文件读写工具仅限访问授权的工作区目录，高风险操作需每次单独确认。

## 6. 测试与构建检查

- `src/**/__tests__`：单元测试与状态流转测试（Vitest）。
- `e2e/critical-acceptance.spec.ts`：核心页面与建课流程端到端测试（Playwright）。

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```
