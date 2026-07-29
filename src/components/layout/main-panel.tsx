'use client';

/**
 * QUARANTINED (B05 / UX08) — Legacy dual-path Home panel.
 *
 * Production Home is App Router `/chat` → HomeChat only.
 * Do NOT mount MainPanel as a product entry — it is a competing visible flow.
 * File retained for reference; export is not used by AppShell or (app) routes.
 *
 * @deprecated Never re-link as production Home.
 */
import { useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChatMessages } from '../chat/chat-messages';
import { ChatInput } from '../chat/chat-input';
import { useChatStore } from '@/store/chat-store';
import { useAgentStore } from '@/store/agent-store';
import { useSettingsStore } from '@/store/settings-store';
import { Sparkles, Lightbulb, Code, Search, FileText, BarChart3, ShieldAlert, ShieldCheck } from 'lucide-react';
import { iconSizes } from '@/lib/icons';

const taskPrompts: Record<string, string> = {
  'research': '帮我搜索和整理关于人工智能在医疗领域应用的最新研究资料，包括关键论文、技术趋势和应用场景',
  'code-review': '请对以下代码进行审查，检查潜在的安全问题、性能瓶颈和最佳实践建议',
  'trpg': '帮我创建一个奇幻世界的跑团冒险剧本，包括世界观设定、NPC角色、主线任务和随机事件表',
  'learning': '帮我制定一个关于机器学习的系统学习计划，包括知识点图谱、学习路径和练习建议',
};

const suggestedTasks = [
  { icon: Code, label: '代码生成', desc: '帮我写一个 Python 脚本来处理 CSV 数据', prompt: '帮我写一个 Python 脚本来读取 CSV 文件，清洗数据并生成统计报告' },
  { icon: Search, label: '信息调研', desc: '搜索并整理特定主题的研究资料', prompt: '帮我搜索和整理关于人工智能在医疗领域应用的最新研究资料' },
  { icon: BarChart3, label: '数据分析', desc: '分析数据集并生成可视化图表', prompt: '我有一个销售数据集，请帮我进行数据分析并生成可视化图表' },
  { icon: FileText, label: '内容创作', desc: '撰写专业文档或报告', prompt: '帮我撰写一份关于项目进展的技术报告，包括里程碑、风险和下一步计划' },
];

/** @deprecated UX08 quarantine — not a production entry (unmounted). */
export function MainPanel() {
  const searchParams = useSearchParams();
  const conversations = useChatStore(s => s.conversations);
  const activeConversationId = useChatStore(s => s.activeConversationId);
  const addMessage = useChatStore(s => s.addMessage);
  const updateMessage = useChatStore(s => s.updateMessage);
  const isLoading = useChatStore(s => s.isLoading);
  const setLoading = useChatStore(s => s.setLoading);
  const renameConversation = useChatStore(s => s.renameConversation);


  const setAgentStatus = useAgentStore(s => s.setStatus);
  const setPlan = useAgentStore(s => s.setPlan);
  const setCurrentStep = useAgentStore(s => s.setCurrentStep);
  const updateStep = useAgentStore(s => s.updateStep);
  const addToolCall = useAgentStore(s => s.addToolCall);
  const updateToolCall = useAgentStore(s => s.updateToolCall);
  const addToolStream = useAgentStore(s => s.addToolStream);
  const addArtifact = useAgentStore(s => s.addArtifact);
  const addExecutionStep = useAgentStore(s => s.addExecutionStep);
  const setPendingToolCall = useAgentStore(s => s.setPendingToolCall);
  const resetAgent = useAgentStore(s => s.reset);
  const { settings } = useSettingsStore();

  const abortRef = useRef<AbortController | null>(null);

  const activeConversation = useMemo(
    () => conversations.find(c => c.id === activeConversationId),
    [conversations, activeConversationId]
  );

  const messages = useMemo(
    () => activeConversation?.messages || [],
    [activeConversation]
  );

  const activePlaybookId = activeConversation?.playbookId;

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setAgentStatus('idle');
  }, [setLoading, setAgentStatus]);

  const handleSendMessage = useCallback(async (content: string) => {
    let convId = useChatStore.getState().activeConversationId;
    if (!convId) {
      const newConv = useChatStore.getState().createConversation();
      convId = newConv.id;
    }

    const userMessage = {
      id: `msg_${Date.now()}`,
      role: 'user' as const,
      content,
      timestamp: new Date(),
    };
    addMessage(userMessage);

    const currentMessages = useChatStore.getState().getActiveMessages();
    if (currentMessages.length <= 1 && convId) {
      const title = content.length > 30 ? content.slice(0, 30) + '...' : content;
      renameConversation(convId, title);
    }

    setLoading(true);
    setAgentStatus('thinking');
    resetAgent();

    const thinkingMsg = {
      id: `msg_${Date.now()}_thinking`,
      role: 'assistant' as const,
      content: '',
      timestamp: new Date(),
      thinking: true,
      thinkingStatus: 'thinking' as const,
    };
    addMessage(thinkingMsg);
    const thinkingMsgId = thinkingMsg.id;

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const store = useSettingsStore.getState();
      const provider = store.getActiveProvider();
      const { settings } = store;

      // Do not send apiKey/baseUrl/workspacePath/executionMode — server env only.
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: content,
          chatHistory: currentMessages,
          providerId: provider.id,
          providerName: provider.name,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          topP: settings.topP,
          frequencyPenalty: settings.frequencyPenalty,
          presencePenalty: settings.presencePenalty,
          activePlaybookId,
          userName: settings.userName,
          systemPrompt: settings.systemPrompt,
          chatId: activeConversationId,
        }),
        signal: ac.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error (${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const dataLine = event.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }

          switch (data.type) {
            case 'thinking':
              updateMessage(thinkingMsgId, { thinkingStatus: 'thinking' });
              break;

            case 'step_start':
              setAgentStatus('executing');
              updateMessage(thinkingMsgId, { thinkingStatus: 'executing' });
              if (data.step && typeof data.step === 'object') {
                const step = data.step as { id: string; status: string };
                updateStep(step.id, { status: 'in_progress' });
              }
              break;

            case 'step_complete':
              if (data.step && typeof data.step === 'object') {
                const step = data.step as { id: string; status: string };
                updateStep(step.id, {
                  status: 'completed',
                  result: data.result as string,
                });
                const current = useAgentStore.getState().state.currentStep;
                setCurrentStep(current + 1);
              }
              break;

            case 'tool_call':
              if (data.toolCall && typeof data.toolCall === 'object') {
                addToolCall(data.toolCall as Parameters<typeof addToolCall>[0]);
              }
              break;

            case 'tool_call_update':
              if (data.toolCall && typeof data.toolCall === 'object') {
                const tc = data.toolCall as { id: string; status: string; result?: string; error?: string };
                updateToolCall(tc.id, {
                  status: tc.status as 'pending' | 'running' | 'completed' | 'failed',
                  result: tc.result,
                  error: tc.error,
                });
              }
              break;

            case 'tool_stream': {
              const chunk = data.chunk as { toolCallId: string; type: string; data: string } | undefined;
              if (chunk?.toolCallId && chunk.type && chunk.data) {
                addToolStream({
                  toolCallId: chunk.toolCallId,
                  type: chunk.type as 'stdout' | 'stderr' | 'status',
                  data: chunk.data,
                  timestamp: Date.now(),
                });
              }
              break;
            }

            case 'execution_step': {
              const step = data.step as { id: string; type: string; title: string; status: string; detail?: string; timestamp: number } | undefined;
              if (step) {
                addExecutionStep({
                  id: step.id,
                  type: step.type as 'plan' | 'tool_call' | 'tool_result' | 'review' | 'error' | 'human_input',
                  title: step.title,
                  status: step.status as 'pending' | 'running' | 'completed' | 'failed' | 'waiting',
                  detail: step.detail,
                  timestamp: step.timestamp,
                });
              }
              break;
            }

            case 'pending_tool_call': {
              const pending = data.pending as { toolCallId: string; toolName: string; parameters: Record<string, unknown> } | undefined;
              if (pending) {
                setPendingToolCall({
                  id: pending.toolCallId,
                  toolName: pending.toolName,
                  parameters: pending.parameters,
                  callId: pending.toolCallId,
                  messageIndex: 0,
                });
              }
              break;
            }

            case 'final':
              updateMessage(thinkingMsgId, { thinkingStatus: 'done' });
              addMessage({
                id: `msg_${Date.now()}_response`,
                role: 'assistant' as const,
                content: data.content as string,
                timestamp: new Date(),
              });
              break;

            case 'done':
              setAgentStatus('done');
              if (Array.isArray(data.plan)) {
                setPlan(data.plan as Parameters<typeof setPlan>[0]);
              }
              if (Array.isArray(data.toolCalls)) {
                const agentStore = useAgentStore.getState();
                for (const tc of data.toolCalls as Array<{ id: string; toolName: string; parameters: Record<string, unknown>; status: string; result?: string; error?: string }>) {
                  const existing = agentStore.state.toolCalls.find(e => e.id === tc.id);
                  if (!existing) {
                    addToolCall({
                      id: tc.id,
                      toolName: tc.toolName,
                      parameters: tc.parameters,
                      status: tc.status as 'pending' | 'running' | 'completed' | 'failed',
                      result: tc.result,
                      error: tc.error,
                    });
                  }
                }
              }
              if (Array.isArray(data.artifacts)) {
                (data.artifacts as Parameters<typeof addArtifact>[0][]).forEach(a => addArtifact(a));
              }
              if (Array.isArray(data.messages)) {
                const fullMessages = (data.messages as Array<{
                  id: string;
                  role: 'user' | 'assistant' | 'tool';
                  content: string;
                  timestamp: string;
                  toolName?: string;
                  toolCallId?: string;
                  toolCalls?: Array<{ id: string; toolName: string; parameters: Record<string, unknown>; status: string; result?: string }>;
                }>).filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool');

                const store = useChatStore.getState();
                store.clearMessages();
                for (const msg of fullMessages) {
                  store.addMessage({
                    id: msg.id,
                    role: msg.role,
                    content: msg.content,
                    timestamp: new Date(msg.timestamp),
                    toolName: msg.toolName,
                    toolCallId: msg.toolCallId,
                    toolCalls: msg.toolCalls?.map(tc => ({
                      id: tc.id,
                      toolName: tc.toolName,
                      parameters: tc.parameters,
                      status: tc.status as 'pending' | 'running' | 'completed' | 'failed',
                      result: tc.result,
                    })),
                  });
                }
              }
              break;

            case 'error':
              setAgentStatus('error');
              updateMessage(thinkingMsgId, { thinkingStatus: 'error' });
              addMessage({
                id: `msg_${Date.now()}_error`,
                role: 'assistant' as const,
                content: `Error: ${data.message}`,
                timestamp: new Date(),
              });
              break;

            case 'complete':
              break;
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        updateMessage(thinkingMsgId, { thinkingStatus: 'error' });
        addMessage({
          id: `msg_${Date.now()}_abort`,
          role: 'assistant' as const,
          content: '已停止生成。',
          timestamp: new Date(),
        });
      } else {
        setAgentStatus('error');
        updateMessage(thinkingMsgId, { thinkingStatus: 'error' });
        addMessage({
          id: `msg_${Date.now()}_catch`,
          role: 'assistant' as const,
          content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date(),
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [addMessage, updateMessage, renameConversation, setLoading, setAgentStatus, setPlan, setCurrentStep, updateStep, addToolCall, updateToolCall, addToolStream, addArtifact, addExecutionStep, setPendingToolCall, resetAgent, activePlaybookId, activeConversationId]);

  const taskProcessed = useRef(false);

  useEffect(() => {
    const task = searchParams.get('task');
    if (task && !taskProcessed.current && !isLoading) {
      taskProcessed.current = true;
      const decoded = decodeURIComponent(task);
      const prompt = taskPrompts[decoded] || decoded;
      handleSendMessage(prompt);
    }
  }, [searchParams, isLoading, handleSendMessage]);

  return (
    <main className="flex-1 flex flex-col bg-[var(--bg-secondary)] min-w-0 relative">
      <div className="absolute inset-0 blueprint-grid opacity-30 pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"></div>

      <div className="relative z-10 px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-primary)]/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 px-3 py-1 border border-[var(--border)] rounded-full bg-[var(--bg-tertiary)]">
            <Sparkles className="w-4 h-4 text-[var(--accent)]" aria-hidden />
            <span className="font-zh text-xs tracking-wide text-[var(--text-secondary)]">
              {activePlaybookId ? '工作流' : '对话'}
            </span>
          </span>
          {settings.executionMode === 'trust' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 border border-amber-500/40 rounded-full bg-amber-500/10 text-amber-700" title="本机权限 — 代码在本机执行">
              <ShieldAlert size={iconSizes.sm} aria-hidden />
              <span className="font-zh text-xs tracking-wide">已授权本机</span>
            </span>
          )}
          {settings.executionMode === 'sandbox' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 border border-[var(--success)]/40 rounded-full bg-[var(--success-bg)] text-[var(--success)]" title="安全环境执行">
              <ShieldCheck size={iconSizes.sm} aria-hidden />
              <span className="font-zh text-xs tracking-wide">安全环境</span>
            </span>
          )}
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-8">
          <div className="max-w-2xl w-full text-center mb-10">
            <div className="w-16 h-16 mx-auto mb-6 border border-[var(--border)] bg-[var(--bg-tertiary)] flex items-center justify-center">
              <Lightbulb size={iconSizes['2xl']} className="text-[var(--accent)]" aria-hidden />
            </div>
            <h2 className="font-classic text-2xl tracking-widest text-[var(--text-primary)] mb-3">
              今天想了解什么？
            </h2>
            <p className="font-zh text-sm text-[var(--text-secondary)] leading-relaxed">
              直接提问即可；需要操作本机或网络时，会先请你确认。
            </p>
          </div>

          <div className="max-w-2xl w-full grid grid-cols-2 gap-3">
            {suggestedTasks.map((task) => (
              <button
                key={task.label}
                onClick={() => handleSendMessage(task.prompt)}
                className="group flex items-start gap-3 p-4 border border-[var(--border-20)] bg-[var(--bg-primary)]/60 hover:bg-[var(--bg-tertiary)]/50 hover:border-[var(--border-40)] transition-all duration-200 text-left"
              >
                <div className="w-8 h-8 shrink-0 flex items-center justify-center border border-[var(--border)] bg-[var(--bg-tertiary)] group-hover:bg-[var(--accent)]/20 transition-colors">
                  <task.icon size={iconSizes.md} className="text-[var(--accent)]" aria-hidden />
                </div>
                <div className="min-w-0">
                  <span className="block font-zh text-sm font-bold text-[var(--text-primary)] mb-0.5">{task.label}</span>
                  <span className="block font-tech text-xs text-[var(--text-secondary)] leading-relaxed">{task.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ChatMessages messages={messages} onCancel={handleCancel} />
      )}

      <ChatInput onSend={handleSendMessage} disabled={isLoading} />
    </main>
  );
}
