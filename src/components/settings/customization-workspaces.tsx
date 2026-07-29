'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Bot,
  Clock3,
  Download,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Shield,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  AuditPolicy,
  AutomationRule,
  UserConfiguration,
  UserPlaybook,
} from '@/lib/config/user-configuration-core';
import type { SceneId } from '@/lib/agents/control-plane/schemas';

type SkillRecord = {
  id: string;
  name: string;
  description: string;
  body: string;
  editableBody: string;
  extraInstructions: string;
  enabled: boolean;
  scenes: string[];
  priority: number;
  source: 'builtin' | 'custom';
  locked: boolean;
  overridden: boolean;
};

type CustomizationPayload = {
  config: UserConfiguration;
  skills: SkillRecord[];
  playbooks: UserPlaybook[];
};

const SCENES: Array<{ id: SceneId; label: string }> = [
  { id: 'chat', label: '对话' },
  { id: 'planning', label: '规划' },
  { id: 'outline', label: '大纲' },
  { id: 'session_teach', label: '课程讲解' },
  { id: 'session_recall', label: '主动回忆' },
  { id: 'session_assess', label: '评估' },
  { id: 'session_remediate', label: '补救' },
  { id: 'desktop', label: '本机任务' },
  { id: 'memory', label: '记忆' },
  { id: 'settings', label: '设置' },
];

const WEEKDAYS = [
  [1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [0, '日'],
] as const;

async function loadCustomization(): Promise<CustomizationPayload> {
  const response = await fetch('/api/settings/customization', { cache: 'no-store' });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error || '加载配置失败');
  return json.data as CustomizationPayload;
}

async function updateCustomization(action: string, data?: unknown, id?: string) {
  const response = await fetch('/api/settings/customization', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data, id }),
  });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error || '保存配置失败');
  return json.data as CustomizationPayload;
}

function StatusLine({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="font-zh text-xs text-[var(--text-secondary)]" role="status">{message}</p>;
}

export function SkillsWorkspace() {
  const [mode, setMode] = useState<'skills' | 'playbooks'>('skills');
  const [payload, setPayload] = useState<CustomizationPayload | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const next = await loadCustomization();
      setPayload(next);
      setSelectedId((current) => current || next.skills[0]?.id || next.playbooks[0]?.id || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载配置失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const skills = payload?.skills || [];
  const playbooks = payload?.playbooks || [];
  const selectedSkill = skills.find((item) => item.id === selectedId);
  const selectedPlaybook = playbooks.find((item) => item.id === selectedId);

  const updateSkill = (patch: Partial<SkillRecord>) => {
    if (!payload || !selectedSkill) return;
    setPayload({
      ...payload,
      skills: payload.skills.map((item) => item.id === selectedSkill.id ? { ...item, ...patch } : item),
    });
  };

  const saveSelectedSkill = async () => {
    if (!selectedSkill) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await updateCustomization('saveSkill', {
        id: selectedSkill.id,
        name: selectedSkill.name,
        description: selectedSkill.description,
        enabled: selectedSkill.enabled,
        body: selectedSkill.locked ? undefined : selectedSkill.editableBody,
        extraInstructions: selectedSkill.extraInstructions,
        scenes: selectedSkill.scenes,
        priority: selectedSkill.priority,
        source: selectedSkill.source,
        updatedAt: new Date().toISOString(),
      });
      setPayload(next);
      setMessage('Skill 已保存并用于后续请求。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Skill 保存失败');
    } finally {
      setBusy(false);
    }
  };

  const resetSelectedSkill = async () => {
    if (!selectedSkill) return;
    setBusy(true);
    try {
      const next = await updateCustomization('resetSkill', undefined, selectedSkill.id);
      setPayload(next);
      setSelectedId(next.skills[0]?.id || '');
      setMessage(selectedSkill.source === 'custom' ? '自定义 Skill 已删除。' : '已恢复内置 Skill。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败');
    } finally {
      setBusy(false);
    }
  };

  const createSkill = () => {
    if (!payload) return;
    const id = `custom-${Date.now()}`;
    const skill: SkillRecord = {
      id,
      name: '新 Skill',
      description: '',
      body: '# Skill: custom\n\nDescribe the behavior.',
      editableBody: '# Skill: custom\n\nDescribe the behavior.',
      extraInstructions: '',
      enabled: true,
      scenes: ['chat'],
      priority: 0,
      source: 'custom',
      locked: false,
      overridden: true,
    };
    setPayload({ ...payload, skills: [skill, ...payload.skills] });
    setSelectedId(id);
  };

  const updatePlaybook = (patch: Partial<UserPlaybook>) => {
    if (!payload || !selectedPlaybook) return;
    setPayload({
      ...payload,
      playbooks: payload.playbooks.map((item) => item.id === selectedPlaybook.id ? { ...item, ...patch } : item),
    });
  };

  const saveSelectedPlaybook = async () => {
    if (!selectedPlaybook) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await updateCustomization('savePlaybook', {
        ...selectedPlaybook,
        updatedAt: new Date().toISOString(),
      });
      setPayload(next);
      setMessage('工作流已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '工作流保存失败');
    } finally {
      setBusy(false);
    }
  };

  const resetSelectedPlaybook = async () => {
    if (!selectedPlaybook) return;
    setBusy(true);
    try {
      const next = await updateCustomization('resetPlaybook', undefined, selectedPlaybook.id);
      setPayload(next);
      setSelectedId(next.playbooks[0]?.id || '');
      setMessage(selectedPlaybook.source === 'custom' ? '自定义工作流已删除。' : '已恢复内置工作流。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败');
    } finally {
      setBusy(false);
    }
  };

  const createPlaybook = () => {
    if (!payload) return;
    const id = `custom-${Date.now()}`;
    const playbook: UserPlaybook = {
      id,
      name: '新工作流',
      description: '',
      prompt: '',
      tools: [],
      steps: [],
      scenes: ['desktop'],
      enabled: true,
      source: 'custom',
      updatedAt: new Date().toISOString(),
    };
    setPayload({ ...payload, playbooks: [playbook, ...payload.playbooks] });
    setSelectedId(id);
  };

  const items = mode === 'skills' ? skills : playbooks;
  return (
    <div className="space-y-3" data-testid="skills-workspace">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex border border-[var(--border-20)] rounded-lg p-0.5" role="tablist" aria-label="配置类型">
          <button type="button" role="tab" aria-selected={mode === 'skills'} onClick={() => { setMode('skills'); setSelectedId(skills[0]?.id || ''); }} className={`px-3 py-1.5 rounded-md font-zh text-xs ${mode === 'skills' ? 'bg-[var(--bg-tertiary)] font-bold' : ''}`}>Skills</button>
          <button type="button" role="tab" aria-selected={mode === 'playbooks'} onClick={() => { setMode('playbooks'); setSelectedId(playbooks[0]?.id || ''); }} className={`px-3 py-1.5 rounded-md font-zh text-xs ${mode === 'playbooks' ? 'bg-[var(--bg-tertiary)] font-bold' : ''}`}>工作流</button>
        </div>
        <button type="button" onClick={mode === 'skills' ? createSkill : createPlaybook} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] font-zh text-xs">
          <Plus size={14} aria-hidden /> 新建
        </button>
      </div>

      <div className="grid min-h-[480px] grid-cols-1 gap-3 md:grid-cols-[210px_minmax(0,1fr)]">
        <div className="border border-[var(--border-20)] rounded-lg overflow-y-auto max-h-[58vh]">
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full border-b border-[var(--border-20)] px-3 py-2.5 text-left last:border-b-0 ${selectedId === item.id ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'}`}>
              <span className="flex items-center gap-1.5 font-zh text-sm font-bold text-[var(--text-primary)]">
                {'locked' in item && item.locked ? <Lock size={12} aria-label="安全规则" /> : mode === 'skills' ? <Wrench size={12} aria-hidden /> : <BookOpen size={12} aria-hidden />}
                {item.name}
              </span>
              <span className="mt-0.5 block truncate font-tech text-[10px] text-[var(--text-muted)]">{item.id}</span>
            </button>
          ))}
          {!busy && items.length === 0 && <p className="p-3 font-zh text-xs text-[var(--text-muted)]">暂无项目</p>}
        </div>

        {mode === 'skills' && selectedSkill && (
          <div className="space-y-3 min-w-0">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1"><span className="font-zh text-xs font-bold">名称</span><input value={selectedSkill.name} disabled={selectedSkill.source === 'builtin'} onChange={(event) => updateSkill({ name: event.target.value })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-zh text-sm" /></label>
              <label className="space-y-1"><span className="font-zh text-xs font-bold">优先级</span><input type="number" min={-100} max={100} value={selectedSkill.priority} onChange={(event) => updateSkill({ priority: Number(event.target.value) || 0 })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-tech text-sm" /></label>
            </div>
            <label className="flex items-center gap-2 font-zh text-xs"><input type="checkbox" checked={selectedSkill.enabled} disabled={selectedSkill.locked} onChange={(event) => updateSkill({ enabled: event.target.checked })} /> {selectedSkill.locked ? '安全规则始终启用' : '启用'}</label>
            <fieldset className="space-y-1.5"><legend className="font-zh text-xs font-bold">适用场景</legend><div className="flex flex-wrap gap-2">{SCENES.map((scene) => <label key={scene.id} className="inline-flex items-center gap-1.5 rounded border border-[var(--border-20)] px-2 py-1 font-zh text-[11px]"><input type="checkbox" checked={selectedSkill.scenes.includes(scene.id)} onChange={(event) => updateSkill({ scenes: event.target.checked ? [...selectedSkill.scenes, scene.id] : selectedSkill.scenes.filter((id) => id !== scene.id) })} />{scene.label}</label>)}</div></fieldset>
            <label className="block space-y-1"><span className="font-zh text-xs font-bold">{selectedSkill.locked ? '内置安全规则（只读）' : 'Skill 正文'}</span><textarea value={selectedSkill.editableBody} readOnly={selectedSkill.locked} onChange={(event) => updateSkill({ editableBody: event.target.value })} rows={12} className="w-full resize-y rounded-lg border border-[var(--border-20)] bg-[var(--bg-secondary)]/40 p-3 font-mono text-xs leading-relaxed" /></label>
            <label className="block space-y-1"><span className="font-zh text-xs font-bold">{selectedSkill.locked ? '追加更严格的限制' : '追加说明'}</span><textarea value={selectedSkill.extraInstructions} onChange={(event) => updateSkill({ extraInstructions: event.target.value })} rows={3} className="w-full resize-y rounded-lg border border-[var(--border-20)] bg-transparent p-3 font-zh text-xs" /></label>
            <details className="rounded-lg border border-[var(--border-20)] p-3"><summary className="cursor-pointer font-zh text-xs font-bold">预览生效内容</summary><pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">{selectedSkill.locked ? selectedSkill.body : `${selectedSkill.editableBody}${selectedSkill.extraInstructions.trim() ? `\n\n## User restrictions\n${selectedSkill.extraInstructions.trim()}` : ''}`}</pre></details>
            <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void resetSelectedSkill()} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 font-zh text-xs"><RotateCcw size={14} aria-hidden />{selectedSkill.source === 'custom' ? '删除' : '恢复默认'}</button><button type="button" onClick={() => void saveSelectedSkill()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--user-bubble-bg)] px-4 py-2 font-zh text-xs font-bold text-[var(--user-bubble-text)]"><Save size={14} aria-hidden />保存</button></div>
          </div>
        )}

        {mode === 'playbooks' && selectedPlaybook && (
          <div className="space-y-3 min-w-0">
            <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1"><span className="font-zh text-xs font-bold">名称</span><input value={selectedPlaybook.name} onChange={(event) => updatePlaybook({ name: event.target.value })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-zh text-sm" /></label><label className="space-y-1"><span className="font-zh text-xs font-bold">工具（逗号分隔）</span><input value={selectedPlaybook.tools.join(', ')} onChange={(event) => updatePlaybook({ tools: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-mono text-xs" /></label></div>
            <label className="block space-y-1"><span className="font-zh text-xs font-bold">说明</span><input value={selectedPlaybook.description} onChange={(event) => updatePlaybook({ description: event.target.value })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-zh text-sm" /></label>
            <label className="block space-y-1"><span className="font-zh text-xs font-bold">工作流提示</span><textarea value={selectedPlaybook.prompt} onChange={(event) => updatePlaybook({ prompt: event.target.value })} rows={10} className="w-full resize-y rounded-lg border border-[var(--border-20)] bg-[var(--bg-secondary)]/40 p-3 font-mono text-xs leading-relaxed" /></label>
            <label className="block space-y-1"><span className="font-zh text-xs font-bold">步骤 JSON</span><textarea value={JSON.stringify(selectedPlaybook.steps, null, 2)} onChange={(event) => { try { updatePlaybook({ steps: JSON.parse(event.target.value) }); } catch { /* keep last valid steps */ } }} rows={9} className="w-full resize-y rounded-lg border border-[var(--border-20)] bg-transparent p-3 font-mono text-xs leading-relaxed" /></label>
            <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void resetSelectedPlaybook()} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 font-zh text-xs"><RotateCcw size={14} aria-hidden />{selectedPlaybook.source === 'custom' ? '删除' : '恢复默认'}</button><button type="button" onClick={() => void saveSelectedPlaybook()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--user-bubble-bg)] px-4 py-2 font-zh text-xs font-bold text-[var(--user-bubble-text)]"><Save size={14} aria-hidden />保存</button></div>
          </div>
        )}
      </div>
      <StatusLine message={message} />
    </div>
  );
}

function newAutomation(): AutomationRule {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name: '新的学习提醒',
    enabled: false,
    trigger: { type: 'daily', time: `${String(now.getHours()).padStart(2, '0')}:00`, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai' },
    action: { type: 'reminder', title: '学习提醒', message: '' },
    approvalPolicy: 'supervised',
    catchUp: true,
    failureCount: 0,
    maxRetries: 2,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function AutomationsWorkspace() {
  const [payload, setPayload] = useState<CustomizationPayload | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await loadCustomization();
      setPayload(next);
      setSelectedId((current) => current || next.config.automations[0]?.id || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载自动化失败');
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const rules = payload?.config.automations || [];
  const selected = rules.find((rule) => rule.id === selectedId);
  const updateRule = (patch: Partial<AutomationRule>) => {
    if (!payload || !selected) return;
    setPayload({ ...payload, config: { ...payload.config, automations: rules.map((rule) => rule.id === selected.id ? { ...rule, ...patch } : rule) } });
  };
  const createRule = () => {
    if (!payload) return;
    const rule = newAutomation();
    setPayload({ ...payload, config: { ...payload.config, automations: [rule, ...rules] } });
    setSelectedId(rule.id);
  };
  const saveRule = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const next = await updateCustomization('saveAutomation', { ...selected, updatedAt: new Date().toISOString() });
      setPayload(next);
      setMessage('自动化已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '自动化保存失败');
    } finally { setBusy(false); }
  };
  const deleteRule = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const next = await updateCustomization('deleteAutomation', undefined, selected.id);
      setPayload(next);
      setSelectedId(next.config.automations[0]?.id || '');
      setMessage('自动化已删除。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '删除失败'); }
    finally { setBusy(false); }
  };
  const runRule = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch('/api/settings/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'runOne', automationId: selected.id, context: { transcript: [] } }) });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || '运行失败');
      setMessage(json.data.message || `运行状态：${json.data.status}`);
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : '运行失败'); }
    finally { setBusy(false); }
  };
  const updateScheduleTime = (time: string) => {
    if (!selected) return;
    if (selected.trigger.type === 'daily') {
      updateRule({ trigger: { ...selected.trigger, time } });
    } else if (selected.trigger.type === 'weekly') {
      updateRule({ trigger: { ...selected.trigger, time } });
    }
  };
  const selectedWeeklyDays = selected?.trigger.type === 'weekly'
    ? selected.trigger.daysOfWeek
    : [];
  const toggleWeeklyDay = (day: number) => {
    if (!selected || selected.trigger.type !== 'weekly') return;
    const exists = selected.trigger.daysOfWeek.includes(day);
    const daysOfWeek = exists
      ? selected.trigger.daysOfWeek.filter((value) => value !== day)
      : [...selected.trigger.daysOfWeek, day];
    if (daysOfWeek.length > 0) updateRule({ trigger: { ...selected.trigger, daysOfWeek } });
  };

  return (
    <div className="space-y-3" data-testid="automations-workspace">
      <div className="flex items-center justify-between gap-2"><div><h3 className="font-zh text-base font-bold">自动化</h3><p className="font-zh text-xs text-[var(--text-muted)]">仅在 Minus 运行时执行；错过的计划下次启动最多补跑一次。</p></div><button type="button" onClick={createRule} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 font-zh text-xs"><Plus size={14} aria-hidden />新建</button></div>
      <div className="grid min-h-[440px] grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="border border-[var(--border-20)] rounded-lg overflow-y-auto max-h-[54vh]">{rules.map((rule) => <button key={rule.id} type="button" onClick={() => setSelectedId(rule.id)} className={`w-full border-b border-[var(--border-20)] px-3 py-2.5 text-left last:border-b-0 ${selectedId === rule.id ? 'bg-[var(--bg-tertiary)]' : ''}`}><span className="flex items-center gap-2 font-zh text-sm font-bold">{rule.action.type === 'profile_digest' ? <Bot size={13} aria-hidden /> : <Clock3 size={13} aria-hidden />}{rule.name}</span><span className="mt-1 block font-zh text-[10px] text-[var(--text-muted)]">{rule.enabled ? '已启用' : '已停用'} · {rule.lastStatus || '未运行'}</span></button>)}{rules.length === 0 && <p className="p-3 font-zh text-xs text-[var(--text-muted)]">暂无自动化</p>}</div>
        {selected ? <div className="space-y-3 min-w-0">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><label className="space-y-1"><span className="font-zh text-xs font-bold">名称</span><input value={selected.name} onChange={(event) => updateRule({ name: event.target.value })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-zh text-sm" /></label><label className="flex items-end gap-2 pb-2 font-zh text-xs"><input type="checkbox" checked={selected.enabled} onChange={(event) => updateRule({ enabled: event.target.checked })} />启用</label></div>
          <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1"><span className="font-zh text-xs font-bold">触发器</span><select value={selected.trigger.type} onChange={(event) => { const type = event.target.value; const now = new Date(); if (type === 'once') updateRule({ trigger: { type: 'once', runAt: new Date(now.getTime() + 3600000).toISOString() } }); else if (type === 'weekly') updateRule({ trigger: { type: 'weekly', time: '09:00', daysOfWeek: [1], timeZone: 'Asia/Shanghai' } }); else if (type === 'event') updateRule({ trigger: { type: 'event', event: 'course_completed', idleMinutes: 1440 } }); else if (type === 'idle') updateRule({ trigger: { type: 'idle', minutes: 30 } }); else updateRule({ trigger: { type: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' } }); }} className="w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-3 py-2 font-zh text-sm"><option value="once">一次</option><option value="daily">每日</option><option value="weekly">每周</option><option value="event">学习事件</option><option value="idle">用户闲置</option></select></label><label className="space-y-1"><span className="font-zh text-xs font-bold">动作</span><select value={selected.action.type} onChange={(event) => { const type = event.target.value; if (type === 'review_proposal') updateRule({ action: { type: 'review_proposal' } }); else if (type === 'agent_task') updateRule({ action: { type: 'agent_task', prompt: '', providerId: 'openai', skillIds: [], webSearchMode: 'auto' } }); else if (type === 'profile_digest') updateRule({ trigger: { type: 'idle', minutes: 30 }, action: { type: 'profile_digest', providerId: 'openai', dailyLimit: 1 } }); else updateRule({ action: { type: 'reminder', title: '学习提醒', message: '' } }); }} className="w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-3 py-2 font-zh text-sm"><option value="reminder">学习提醒</option><option value="review_proposal">复习建议</option><option value="agent_task">Agent 任务</option><option value="profile_digest">用户画像解读</option></select></label></div>
          {(selected.trigger.type === 'daily' || selected.trigger.type === 'weekly') && <label className="block space-y-1"><span className="font-zh text-xs font-bold">时间</span><input type="time" value={selected.trigger.time} onChange={(event) => updateScheduleTime(event.target.value)} className="rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-tech text-sm" /></label>}
          {selected.trigger.type === 'once' && <label className="block space-y-1"><span className="font-zh text-xs font-bold">运行时间</span><input type="datetime-local" value={selected.trigger.runAt.slice(0, 16)} onChange={(event) => updateRule({ trigger: { type: 'once', runAt: new Date(event.target.value).toISOString() } })} className="rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-tech text-sm" /></label>}
          {selected.trigger.type === 'idle' && <label className="block space-y-1"><span className="font-zh text-xs font-bold">闲置分钟</span><input type="number" min={5} max={720} value={selected.trigger.minutes} onChange={(event) => updateRule({ trigger: { type: 'idle', minutes: Number(event.target.value) || 30 } })} className="w-32 rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-tech text-sm" /></label>}
          {selected.trigger.type === 'weekly' && <fieldset className="space-y-1"><legend className="font-zh text-xs font-bold">运行日</legend><div className="flex flex-wrap gap-1">{WEEKDAYS.map(([day, label]) => <button key={day} type="button" aria-pressed={selectedWeeklyDays.includes(day)} onClick={() => toggleWeeklyDay(day)} className={`h-8 w-8 rounded-md border font-zh text-xs ${selectedWeeklyDays.includes(day) ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border-[var(--border-20)]'}`}>{label}</button>)}</div></fieldset>}
          {selected.trigger.type === 'event' && <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1"><span className="font-zh text-xs font-bold">学习事件</span><select value={selected.trigger.event} onChange={(event) => { if (selected.trigger.type === 'event') updateRule({ trigger: { ...selected.trigger, event: event.target.value as 'course_completed' | 'assessment_failed' | 'course_idle' } }); }} className="w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-3 py-2 font-zh text-xs"><option value="course_completed">课程完成</option><option value="assessment_failed">评估未通过</option><option value="course_idle">课程闲置</option></select></label><label className="space-y-1"><span className="font-zh text-xs font-bold">限定课程 ID（可选）</span><input value={selected.trigger.courseId || ''} onChange={(event) => { if (selected.trigger.type === 'event') updateRule({ trigger: { ...selected.trigger, courseId: event.target.value || undefined } }); }} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-mono text-xs" /></label>{selected.trigger.event === 'course_idle' && <label className="space-y-1"><span className="font-zh text-xs font-bold">课程闲置分钟</span><input type="number" min={30} max={43200} value={selected.trigger.idleMinutes} onChange={(event) => { if (selected.trigger.type === 'event') updateRule({ trigger: { ...selected.trigger, idleMinutes: Number(event.target.value) || 1440 } }); }} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-mono text-xs" /></label>}</div>}
          {selected.action.type === 'reminder' && <div className="space-y-2"><input value={selected.action.title} onChange={(event) => updateRule({ action: { type: 'reminder', title: event.target.value, message: selected.action.type === 'reminder' ? selected.action.message : '' } })} placeholder="提醒标题" className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-zh text-sm" /><textarea value={selected.action.message} onChange={(event) => updateRule({ action: { type: 'reminder', title: selected.action.type === 'reminder' ? selected.action.title : '学习提醒', message: event.target.value } })} placeholder="提醒内容" rows={4} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent p-3 font-zh text-sm" /></div>}
          {selected.action.type === 'agent_task' && <div className="space-y-2"><textarea value={selected.action.prompt} onChange={(event) => updateRule({ action: selected.action.type === 'agent_task' ? { ...selected.action, prompt: event.target.value } : selected.action })} placeholder="Agent 任务" rows={6} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent p-3 font-zh text-sm" /><div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1"><span className="font-zh text-xs font-bold">模型 Provider</span><input value={selected.action.providerId} onChange={(event) => updateRule({ action: selected.action.type === 'agent_task' ? { ...selected.action, providerId: event.target.value } : selected.action })} placeholder="providerId" className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-mono text-xs" /></label><label className="space-y-1"><span className="font-zh text-xs font-bold">联网策略</span><select value={selected.action.webSearchMode} onChange={(event) => updateRule({ action: selected.action.type === 'agent_task' ? { ...selected.action, webSearchMode: event.target.value as 'auto' | 'always' | 'off' } : selected.action })} className="w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-3 py-2 font-zh text-xs"><option value="auto">智能</option><option value="always">每次</option><option value="off">关闭</option></select></label><label className="space-y-1"><span className="font-zh text-xs font-bold">Playbook</span><select value={selected.action.playbookId || ''} onChange={(event) => updateRule({ action: selected.action.type === 'agent_task' ? { ...selected.action, playbookId: event.target.value || undefined } : selected.action })} className="w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-3 py-2 font-zh text-xs"><option value="">不使用</option>{payload?.playbooks.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="space-y-1"><span className="font-zh text-xs font-bold">目标课程 ID（可选）</span><input value={selected.action.courseId || ''} onChange={(event) => updateRule({ action: selected.action.type === 'agent_task' ? { ...selected.action, courseId: event.target.value || undefined } : selected.action })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-mono text-xs" /></label></div><fieldset className="space-y-1"><legend className="font-zh text-xs font-bold">启用 Skills</legend><div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{payload?.skills.filter((item) => item.enabled).map((item) => <label key={item.id} className="inline-flex items-center gap-1 rounded border border-[var(--border-20)] px-2 py-1 font-zh text-[10px]"><input type="checkbox" checked={selected.action.type === 'agent_task' && selected.action.skillIds.includes(item.id)} onChange={(event) => { if (selected.action.type !== 'agent_task') return; updateRule({ action: { ...selected.action, skillIds: event.target.checked ? [...selected.action.skillIds, item.id] : selected.action.skillIds.filter((id) => id !== item.id) } }); }} />{item.name}</label>)}</div></fieldset></div>}
          {selected.action.type === 'profile_digest' && <div className="rounded-lg border border-[var(--border-20)] p-3"><p className="font-zh text-xs text-[var(--text-secondary)]">只分析最近的对话与学习文本，排除工具日志和敏感信息；结果进入待确认记忆。</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={selected.action.providerId} onChange={(event) => updateRule({ action: selected.action.type === 'profile_digest' ? { ...selected.action, providerId: event.target.value } : selected.action })} placeholder="providerId" className="rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-mono text-xs" /><input type="number" min={1} max={10} value={selected.action.dailyLimit} onChange={(event) => updateRule({ action: selected.action.type === 'profile_digest' ? { ...selected.action, dailyLimit: Number(event.target.value) || 1 } : selected.action })} className="rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-mono text-xs" /></div></div>}
          <div className="grid gap-2 sm:grid-cols-3"><label className="flex items-center gap-2 font-zh text-xs"><input type="checkbox" checked={selected.catchUp} onChange={(event) => updateRule({ catchUp: event.target.checked })} />启动时补处理错过任务</label><label className="space-y-1"><span className="font-zh text-xs font-bold">审批策略</span><select value={selected.approvalPolicy} onChange={(event) => updateRule({ approvalPolicy: event.target.value as 'supervised' | 'bounded_auto' })} className="w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-2 py-1.5 font-zh text-xs"><option value="supervised">需要确认</option><option value="bounded_auto">受限自动</option></select></label><label className="space-y-1"><span className="font-zh text-xs font-bold">失败重试</span><input type="number" min={0} max={5} value={selected.maxRetries} onChange={(event) => updateRule({ maxRetries: Math.min(5, Math.max(0, Number(event.target.value) || 0)) })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-2 py-1.5 font-mono text-xs" /></label></div>
          {selected.lastError && <p className="rounded-lg bg-red-50 p-2 font-zh text-xs text-red-700">{selected.lastError}</p>}
          <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void deleteRule()} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-2 font-zh text-xs text-red-700"><Trash2 size={14} aria-hidden />删除</button><button type="button" onClick={() => void runRule()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 font-zh text-xs"><Play size={14} aria-hidden />试运行</button><button type="button" onClick={() => void saveRule()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--user-bubble-bg)] px-4 py-2 font-zh text-xs font-bold text-[var(--user-bubble-text)]"><Save size={14} aria-hidden />保存</button></div>
        </div> : <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-20)] bg-[var(--surface-soft)] p-6 text-center"><Clock3 size={24} className="text-[var(--text-muted)]" aria-hidden /><h4 className="mt-3 font-zh text-sm font-bold">创建第一条自动化</h4><p className="mt-1 max-w-sm font-zh text-xs leading-relaxed text-[var(--text-muted)]">选择触发时间或学习事件，再配置提醒、复习建议、Agent 任务或待确认画像。</p><button type="button" onClick={createRule} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--user-bubble-bg)] px-4 py-2 font-zh text-xs font-bold text-[var(--user-bubble-text)]"><Plus size={14} aria-hidden />新建自动化</button></div>}
      </div>
      {(payload?.config.automationNotices.length || 0) > 0 && <details className="rounded-lg border border-[var(--border-20)] p-3"><summary className="cursor-pointer font-zh text-xs font-bold">运行结果 · {payload?.config.automationNotices.length}</summary><ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">{payload?.config.automationNotices.slice(0, 20).map((item) => <li key={item.id} className="border-b border-[var(--border-20)] pb-2 last:border-b-0"><p className="font-zh text-xs font-bold">{item.title}</p><p className="line-clamp-3 font-zh text-[11px] text-[var(--text-secondary)]">{item.message}</p></li>)}</ul></details>}
      <StatusLine message={message} />
    </div>
  );
}

type AuditRow = { timestamp: string; kind: string; detail: string };

export function AuditWorkspace({ refreshKey }: { refreshKey?: string }) {
  const [policy, setPolicy] = useState<AuditPolicy | null>(null);
  const [networkAccess, setNetworkAccess] = useState<'allow' | 'ask' | 'off'>('ask');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [custom, safetyResponse] = await Promise.all([loadCustomization(), fetch('/api/settings/safety', { cache: 'no-store' })]);
      const safety = await safetyResponse.json();
      if (!safetyResponse.ok || !safety.success) throw new Error(safety.error || '加载审计失败');
      setPolicy(custom.config.auditPolicy);
      setNetworkAccess(custom.config.networkAccess);
      setRows([...(safety.data.audit?.safety || []), ...(safety.data.audit?.trust || [])].sort((a: AuditRow, b: AuditRow) => b.timestamp.localeCompare(a.timestamp)));
    } catch (error) { setMessage(error instanceof Error ? error.message : '加载审计失败'); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload, refreshKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? rows.filter((row) => `${row.kind} ${row.detail}`.toLocaleLowerCase().includes(needle)) : rows;
  }, [query, rows]);
  const save = async () => {
    if (!policy) return;
    try {
      await updateCustomization('saveAuditPolicy', policy);
      await updateCustomization('saveNetworkAccess', networkAccess);
      setMessage('审计与网络策略已保存。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '策略保存失败'); }
  };
  const exportRows = () => {
    const blob = new Blob([filtered.map((row) => JSON.stringify(row)).join('\n')], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `minus-audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const clear = async () => {
    const response = await fetch('/api/settings/safety', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clearAudit' }) });
    const json = await response.json();
    if (!response.ok || !json.success) { setMessage(json.error || '清理失败'); return; }
    setConfirmClear(false);
    setMessage('审计日志已清理，并记录了本次清理事件。');
    await reload();
  };

  return <div className="space-y-4" data-testid="audit-workspace">
    <section className="space-y-3"><div className="flex items-center gap-2"><Shield size={16} aria-hidden /><h3 className="font-zh text-base font-bold">审计策略</h3></div>{policy && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span className="font-zh text-xs font-bold">保留天数</span><input type="number" min={1} max={3650} value={policy.retentionDays ?? 3650} onChange={(event) => setPolicy({ ...policy, retentionDays: Number(event.target.value) || 90 })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-tech text-sm" /></label><label className="space-y-1"><span className="font-zh text-xs font-bold">脱敏级别</span><select value={policy.redactLevel} onChange={(event) => setPolicy({ ...policy, redactLevel: event.target.value as 'standard' | 'strict' })} className="w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-3 py-2 font-zh text-sm"><option value="standard">标准</option><option value="strict">严格</option></select></label><label className="space-y-1"><span className="font-zh text-xs font-bold">最大文件 MB</span><input type="number" min={1} max={100} value={Math.round(policy.maxFileBytes / 1024 / 1024)} onChange={(event) => setPolicy({ ...policy, maxFileBytes: Math.max(1, Number(event.target.value) || 5) * 1024 * 1024 })} className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-tech text-sm" /></label><label className="space-y-1"><span className="font-zh text-xs font-bold">只读联网</span><select value={networkAccess} onChange={(event) => setNetworkAccess(event.target.value as 'allow' | 'ask' | 'off')} className="w-full rounded-lg border border-[var(--border-20)] bg-[var(--surface)] px-3 py-2 font-zh text-sm"><option value="allow">允许</option><option value="ask">每次询问</option><option value="off">禁止</option></select></label><label className="space-y-1 sm:col-span-2"><span className="font-zh text-xs font-bold">附加记录类别（逗号分隔）</span><input value={policy.optionalKinds.join(', ')} onChange={(event) => setPolicy({ ...policy, optionalKinds: event.target.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 100) })} placeholder="automation_run, trust_execution" className="w-full rounded-lg border border-[var(--border-20)] bg-transparent px-3 py-2 font-mono text-xs" /></label></div>}<p className="flex items-center gap-1.5 font-zh text-[11px] text-[var(--text-muted)]"><Lock size={12} aria-hidden />授权变更、红线拦截和日志清理始终记录。</p><div className="flex justify-end"><button type="button" onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--user-bubble-bg)] px-4 py-2 font-zh text-xs font-bold text-[var(--user-bubble-text)]"><Save size={14} aria-hidden />保存策略</button></div></section>
    <section className="space-y-3 border-t border-[var(--border-20)] pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><label className="relative min-w-0 flex-1"><Search size={14} className="absolute left-3 top-2.5 text-[var(--text-muted)]" aria-hidden /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事件或详情" className="w-full rounded-lg border border-[var(--border-20)] bg-transparent py-2 pl-9 pr-3 font-zh text-xs" /></label><button type="button" onClick={exportRows} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 font-zh text-xs"><Download size={14} aria-hidden />导出</button></div><ul className="max-h-[38vh] overflow-y-auto rounded-lg border border-[var(--border-20)] divide-y divide-[var(--border-20)]">{filtered.map((row, index) => <li key={`${row.timestamp}-${index}`} className="px-3 py-2"><p className="font-tech text-[10px] text-[var(--text-muted)]">{new Date(row.timestamp).toLocaleString()} · {row.kind}</p><p className="mt-0.5 font-zh text-xs text-[var(--text-secondary)]">{row.detail}</p></li>)}{filtered.length === 0 && <li className="p-4 font-zh text-xs text-[var(--text-muted)]">暂无匹配记录</li>}</ul>{confirmClear ? <div className="flex items-center justify-end gap-2 rounded-lg bg-red-50 p-3"><p className="mr-auto font-zh text-xs text-red-800">清理全部现有日志？该动作会留下新的清理记录。</p><button type="button" onClick={() => setConfirmClear(false)} className="px-3 py-1.5 font-zh text-xs">取消</button><button type="button" onClick={() => void clear()} className="rounded bg-red-700 px-3 py-1.5 font-zh text-xs font-bold text-white">确认清理</button></div> : <div className="flex justify-end"><button type="button" onClick={() => setConfirmClear(true)} className="inline-flex items-center gap-1.5 px-3 py-2 font-zh text-xs text-red-700"><Trash2 size={14} aria-hidden />清理日志</button></div>}</section>
    <StatusLine message={message} />
  </div>;
}
