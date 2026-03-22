# MVP Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six features to make yeastbook a polished MVP: keyboard shortcuts with command/edit modes, command palette, notebook dashboard, AI copilot, interactive widgets, MIME output, and auto-save.

**Architecture:** Each feature is independent. Tasks ordered by dependency: auto-save and MIME first (quick backend wins), then keyboard shortcuts and palette (UI-only), then widgets and AI (full-stack), then dashboard (new page).

**Tech Stack:** Bun, React, Monaco Editor, Anthropic/OpenAI streaming APIs, DOMPurify

**Branch:** `feature/mvp-polish` off `staging`

**Tasks:** 9 tasks covering all 6 features plus console.table and final verification.

---

## Task 1: Auto-Save
## Task 2: MIME Output Detection + Renderer
## Task 3: Keyboard Shortcuts + Command/Edit Mode + Status Bar
## Task 4: Command Palette
## Task 5: Interactive Widgets (core + UI + server)
## Task 6: AI Copilot (module + endpoint + UI)
## Task 7: Notebook Dashboard (page + CLI + API)
## Task 8: console.table Interceptor
## Task 9: Final Build, Test, Merge

See full plan at docs/superpowers/plans/2026-03-21-mvp-polish.md (this file).
Each task has detailed steps with exact file paths, code, and test commands.
