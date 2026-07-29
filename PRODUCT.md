# Product

## Register

product

## Users

Learners and technical power users who want a **local-first general chat product** that can graduate into a structured learning loop: free multi-turn dialogue first; when the user explicitly wants to learn something, propose a plan, get confirmation, then enter a modular course runtime—with materials and progress kept on disk.

> **Strategic note (2026-07-14):** The shipped primary shell is **chat-first**: Home (streaming `/api/chat`) plus first-class Library, Calendar, and History surfaces. Course is a confirmed project mode (propose ≠ commit). Desktop tools remain available behind the same Home with sandbox-first execution and HITL. Video is intentionally hidden from primary navigation until it has a real product capability.

## Product Purpose

Minus is a **local-first conversation shell** that can open a durable learning loop:

**General chat → (explicit/fuzzy confirm) → calibrate → curriculum propose → user agree → course modules → artifacts / feedback → replan**

Inspiration includes Hyperknow-style home + Gemini blank-slate chat + Study/Notebook patterns. Data stays local (`~/.minus/data/`). User confirmation gates any committed study plan.

Optional infrastructure: general Agent (plan → tools → sandbox) and the older learning workbench APIs remain available behind the chat shell.

## Brand Personality

Professional, methodical, transparent. Three words: **structured**, **trustworthy**, **restrained**. The interface should feel like a precision instrument — clear hierarchy, purposeful motion, no decorative noise. Learning semantics (task states, section locks, citations) beat decorative chrome.

## Anti-references

- Generic SaaS cream-and-purple dashboards.
- Glassmorphism used as decoration.
- Gradient text and oversized hero metrics.
- Over-animated entrance effects that delay content.
- Cluttered side-stripe borders and identical card grids.
- Copying third-party brand names, mascots, or unverified internal product claims.

## Design Principles

1. **Chat first.** Home must support real multi-turn streaming dialogue before any learning chrome.
2. **Learning is a gate, not a hijack.** Explicit intent or confirmed fuzzy intent enters calibrate → plan → course; never silent mode switch.
3. **Propose ≠ commit.** Pending curriculum and tasks need user agreement before schedule/course lock-in.
4. **Stable IA with honest capability.** Primary nav is `home | library | calendar | history` (+ Settings). Incomplete capabilities stay hidden or use an explicit honest empty state.
5. **Show the process.** Progress, citations, assessments, and planner decisions stay visible and auditable in course mode.
6. **Trust through transparency.** Local persistence, explicit rules, interruptible streams; clear missing-key errors.
7. **Keyboard-first efficiency.** Power users should drive chat and course flows without relying on the mouse.

## Target architecture (product view)

```text
Home streaming chat (/api/chat)
     ↓  learn_explicit | learn_fuzzy→confirm
Calibrate → Curriculum propose → user agree
     ↓
Course typed blocks + follow-up chat
     ↓
Library / Calendar / History
Video metadata route (hidden until a real capability ships)
```

The learning repository, tasks, materials, sessions, artifacts, feedback, and learner profile form the course-mode backend. Runtime structure and data-flow documentation is maintained in [`PROJECT-STRUCTURE.md`](./PROJECT-STRUCTURE.md).

## Accessibility & Inclusion

- Target WCAG 2.1 AA for text contrast, focus states, and keyboard navigation.
- Respect `prefers-reduced-motion`: disable non-essential animations for users who request it.
- Support screen-reader friendly labels on all icon-only controls and learning-state changes (task status, section lock, assessment result).
