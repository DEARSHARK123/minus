# Minus 当前项目结构

最后校准：2026-07-14

本文件描述当前实现，不承担产品路线决策。产品方向与不可破坏的体验约束以 `PRODUCT.md` 为准。

## 1. 运行时结构

```text
src/
├─ app/
│  ├─ page.tsx                         # / → /chat 草稿
│  ├─ (app)/
│  │  ├─ layout.tsx                    # AppShell
│  │  ├─ chat/page.tsx                 # HomeChat
│  │  ├─ course/[id]/page.tsx          # Course / Session
│  │  ├─ library/page.tsx
│  │  ├─ calendar/page.tsx
│  │  ├─ history/page.tsx
│  │  └─ video/page.tsx                # 非主导航元数据页
│  └─ api/
│     ├─ chat/                          # 普通流式对话与 threads
│     ├─ agents/run/                    # 学习编排
│     ├─ agent/                         # Desktop 工具循环与 HITL
│     ├─ learning/                      # 学习域持久化与操作
│     ├─ memory/
│     └─ settings/                     # Skills、自动化、审计、数据包与安全策略
├─ components/
│  ├─ chat/                             # 当前主要产品表面
│  ├─ layout/                           # AppShell 与 Sidebar
│  ├─ learning/                         # 资料库与课程后端 UI 组件
│  ├─ providers/                        # Theme 与持久化 store hydration gate
│  ├─ settings/
│  ├─ ui/
│  ├─ agent/                            # 非默认表面
│  └─ monitor/                          # 遗留隔离组件
├─ lib/
│  ├─ agents/                           # 学习编排与控制平面
│  ├─ agent/                            # Desktop Agent loop、策略与 HITL
│  ├─ chat/                             # 对话策略、文案和安全恢复
│  ├─ learning/                         # 学习仓库、规划、Session
│  ├─ automation/                       # 应用运行期调度、幂等、重试与 HITL 转交
│  ├─ config/                           # UserConfigurationV1 与用户覆盖解析
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
│  └─ agent-store.ts                    # 主要供遗留 Agent 表面使用
└─ types/
```

## 2. 产品表面

### Home / Chat

`src/components/chat/home-chat.tsx` 是当前最重要的客户端入口，承担：

- 普通对话与 SSE；
- 用户消息编辑、assistant 重新生成和安全截断；
- 学习意图路由、澄清卡片和大纲卡片；
- Desktop 工具流、执行事件和单一 HITL 确认；
- 日历规划桥接；
- Composer、模式选择、错误提示与滚动。

该组件职责过多，已经被列入 UX P0 拆分与状态收敛范围。

### Course

`/course/[id]` 根据 course 和 session 参数加载学习实体。课程创建只允许从已确认的大纲触发；大纲编辑本身不持久化课程。

课程 Session 把模型知识作为主要讲解来源；本地命中与公开网页只作为可选证据层。
`webSearchMode` 随 Session 持久化。只有通过实质性检查的模型讲解/追问才会追加到
turns，失败不会写入兜底文本；旧模板或过短讲解可在原历史后追加“重新讲解”。

### Settings 工作台

- `Skills`：自动发现 `skills/*.md`，内置文件不可变，修改写入用户覆盖；锁定安全 Skill 只能追加限制。
- `Playbook`：提示词、工具、步骤、参数与适用场景使用同一覆盖模型。
- `自动化`：规则只在 Minus 运行时检查；时间、课程事件、用户/课程闲置均使用稳定 run key 防重复，失败有限重试。
- `审计`：原始事件不可逐条修改；用户只编辑保留、脱敏、类别和大小策略。

### Library

`LibraryPage` 挂载 `KnowledgeBase`，支持资料、文件夹、搜索、导入建议及实体管理。资料操作可预填 Home Composer，但当前跨表面的动作层级仍需简化。

### Calendar

`CalendarPage` 由月历、今日任务、待确认建议和学习伴侣组成。学习伴侣维护按课程隔离的短对话，通过结构化白名单动作重新规划或移动草案任务；模型不能确认日程。计划草案与正式写入分离，只有明确确认才修改日历。

### History

`HistoryPage` 分为对话和学习记录。对话恢复必须关闭自动工具重放；课程记录可继续已有 Session 或创建 Session。

### Video

`VideoPage` 只展示资料库中识别到的视频相关文本或元数据。Sidebar 不提供主入口，避免承诺未实现的播放器。

## 3. 状态所有权

| Store | 职责 | 不应承担 |
|---|---|---|
| `chat-store` | 对话、消息、当前 turn、会话 experience 快照、持久化迁移 | 学习实体 CRUD |
| `learn-flow-store` | 每个 conversation 的学习编排阶段、卡片、Desktop events | 跨会话共享临时状态 |
| `learning-store` | 课程、资料、任务、日程、Session 和学习结果 | 普通对话消息 |
| `settings-store` | provider、安全、执行模式和学习偏好 | 保存客户端 API Key |
| `ui-store` | 当前视图、Sidebar、Settings 和响应式 UI | 业务实体 |
| `agent-store` | 遗留通用 Agent 表面状态 | HomeChat 的主状态源 |

URL 是页面导航的事实源；AppShell 负责把 URL 同步到相应 store。不要再引入仅靠内存切换、刷新即丢失的主导航。

`StoreHydrationGate` 在产品壳挂载前显式恢复 `chat-store` 与
`settings-store`。服务端 HTML 与浏览器首次渲染因此共享同一中性状态；
恢复后再按 `/chat` 或 `/chat?c=<id>` 对齐会话，避免 hydration warning 和
历史对话一帧闪现。

## 4. 主要数据流

### 普通对话

```text
HomeChat
  → considerUserMessage
  → normal route
  → POST /api/chat
  → SSE 写入当前 assistant message
  → 可选 memory extraction
```

### 深入学习

```text
用户选择深入学习或明确表达学习意图
  → 学习编排 / 澄清
  → 可编辑 outline
  → 用户点击开始学习
  → createCourse
  → createLearningPathFromOutline
  → createSession
  → /course/<id>?s=<sessionId>
```

### Desktop

```text
用户请求本机任务
  → action policy
  → sandbox 默认执行
  → 危险工具或 trust elevation
  → pending_tool_confirm
  → 用户允许 / 拒绝 / 取消
  → resume token 继续
```

### Calendar

```text
Home 或 Calendar 学习伴侣收集调整要求
  → AI 结构化动作（解释 / 重新规划 / 移动单项）
  → proposal preview
  → 用户编辑
  → confirmPlan
  → 学习日历
```

## 5. 持久化与安全边界

- 学习数据写入本地学习仓库，默认目录由服务端决定。
- `UserConfigurationV1` 原子写入 `~/.minus/data/user-configuration.json`，并进入不含密钥/审计日志的数据包备份。
- 对话和 learn-flow 使用带迁移的 Zustand persistence。
- provider secret 只在服务端环境变量中解析。
- 文件工具只允许访问配置的 workspace 边界。
- dangerous tool 必须经过 HITL。
- trust elevation 不等于自动批准后续危险操作。
- 编辑或重新生成历史消息不会自动撤销已提交课程、文件或日程副作用。

## 6. 遗留与隔离代码

以下代码可作为历史实现参考，但不是产品主入口：

- `src/components/layout/main-panel.tsx`
- `src/components/layout/monitor-panel.tsx`
- `src/components/monitor/**`
- `src/components/learning/workspace.tsx`
- `src/components/learning/learning-feed.tsx`
- `src/store/agent-store.ts` 驱动的旧三栏状态
- `src/app/aether/**` 与 `src/components/aether/**`

新功能不得重新挂载这些表面，除非先更新 `PRODUCT.md` 并完成迁移方案。

## 7. 测试结构

- `src/**/__tests__`：模块与状态机测试。
- `e2e/critical-acceptance.spec.ts`：路由、Deep、隔离、编辑、CRUD 与 HITL 验收。
- `scripts/timed-verify.ps1`：开发服务器、Home 和 API 的限时烟测。

常用检查：

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

## 8. 扩展规则

- 新页面必须拥有 URL，不只依赖 `activeAppView`。
- 新异步流程必须绑定 conversation、turn 和 generation，拒绝 stale write。
- 新确认场景只能选择一个主表面：内联卡片或 modal/dialog。
- 新学习实体只能在明确提交动作后持久化。
- 新 Desktop 工具默认 sandbox，并声明危险等级。
- 用户可见文案不得暴露 Agent 类名、内部 stage、prompt、token 或安全实现术语。
