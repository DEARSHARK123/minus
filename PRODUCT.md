# Minus Product Overview

## Target Users

Self-directed learners and technical users who want a **local-first chat application** that can transition smoothly into structured study: starting from free-form multi-turn dialogue, proposing a study outline when requested, and—once confirmed—opening a modular course workspace with local materials, exercises, and schedule tracking.

## Core Workflow

```text
General chat (/api/chat)
     ↓  explicit or confirmed learning intent
Goal calibration → Editable outline → User confirmation
     ↓
Course modules + exercises + follow-up Q&A
     ↓
Library / Calendar / History
```

All learning data is stored locally on disk (`~/.minus/data/`). Draft outlines and schedule adjustments require explicit user confirmation before being written to the local repository.

## Core Design Principles

1. **Chat-first entry.** The home view supports standard multi-turn streaming chat without forcing every question into a course workflow.
2. **Explicit transition to course mode.** Entering structured study requires either an explicit user request or confirmation of a detected learning intent.
3. **Draft before commit.** Generated curricula, material edits, and calendar changes are previewed as editable drafts before persistence.
4. **Focused navigation.** Primary navigation covers `Home | Library | Calendar | History` (plus Settings).
5. **Traceable study state.** Course progress, reference sources, exercises, and schedule adjustments remain inspectable and editable by the user.
6. **Keyboard-friendly interaction.** Common chat and course actions can be driven via keyboard shortcuts.

## Accessibility

- Aims for WCAG 2.1 AA contrast, visible focus states, and keyboard navigation across views.
- Respects `prefers-reduced-motion` by disabling non-essential transitions when requested.
- Provides accessible labels on icon-only controls and task/course status indicators.
