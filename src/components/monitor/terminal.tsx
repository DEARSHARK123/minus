'use client';

import { useState, useRef, useEffect } from 'react';

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'success';
  content: string;
  timestamp: Date;
}

interface TerminalProps {
  initialLines?: TerminalLine[];
  onInput?: (input: string) => void;
}

export function Terminal({ initialLines = [], onInput }: TerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>(initialLines);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const linesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    linesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const inputLine: TerminalLine = {
      id: `input_${Date.now()}`,
      type: 'input',
      content: `$ ${input}`,
      timestamp: new Date(),
    };

    setLines(prev => [...prev, inputLine]);
    setHistory(prev => [...prev, input]);
    setHistoryIndex(-1);

    onInput?.(input);

    setTimeout(() => {
      const outputLine: TerminalLine = {
        id: `output_${Date.now()}`,
        type: 'success',
        content: `执行命令: ${input}`,
        timestamp: new Date(),
      };
      setLines(prev => [...prev, outputLine]);
    }, 500);

    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIndex);
          setInput(history[newIndex]);
        }
      }
    }
  };

  const getLineColor = (type: TerminalLine['type']) => {
    switch (type) {
      case 'input': return 'text-[var(--accent)]';
      case 'error': return 'text-red-400';
      case 'success': return 'text-green-400';
      default: return 'text-[var(--bg-primary)]';
    }
  };

  return (
    <div className="rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--code-bg)]">
      <div className="flex items-center px-4 py-2 bg-[var(--code-header-bg)] border-b border-[var(--border)]">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[var(--error)]" />
          <div className="w-3 h-3 rounded-full bg-[var(--warning)]" />
          <div className="w-3 h-3 rounded-full bg-[var(--success)]" />
        </div>
        <span className="font-tech text-xs text-[var(--accent)] ml-2">终端</span>
      </div>

      <div className="p-4 h-[280px] overflow-y-auto font-tech text-sm">
        {lines.map((line) => (
          <div key={line.id} className={`mb-1 ${getLineColor(line.type)}`}>
            {line.content}
          </div>
        ))}
        <div ref={linesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-[var(--border)] p-2">
        <div className="flex items-center gap-2">
          <span className="text-[var(--accent)] font-tech">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-[var(--code-text)] font-tech text-sm focus:outline-none"
            placeholder="输入命令..."
            autoFocus
          />
        </div>
      </form>
    </div>
  );
}
