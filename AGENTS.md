# AGENTS.md

This document defines working rules for AI agents in this repository.

Do not modify files outside this codebase.

## 1. Project Overview

This repository is OpenPower Studio, a local web app for building small power
networks and running electrical studies.

Main parts:
- `frontend/`: Vite + React single-page app for the canvas editor and study UI
- `backend/`: FastAPI service that builds pandapower networks and runs studies
- `tasks/`, `skills/`, `progress.txt`, `ralph*.sh`: repo workflow artifacts and
  automation support files

Primary supported studies today:
- Load flow
- Short circuit
- Protection coordination curve generation

## 2. Technology Stack

Frontend:
- JavaScript + JSX
- React 18
- React Router
- React Flow
- Axios
- Vite

Backend:
- Python
- FastAPI
- Pydantic
- pandapower

Do not introduce major new frameworks unless the task requires them.

## 3. Architecture Rules

Follow the current monorepo split.

Frontend responsibilities:
- Canvas interactions and editor state
- Node and edge editing
- Study setup controls
- Payload construction for backend API calls
- Rendering returned study results on the graph

Backend responsibilities:
- Input validation
- pandapower network construction
- Load-flow and short-circuit calculations
- Result shaping for frontend consumption

Keep UI-specific graph state separate from backend calculation models. The
frontend may store transient annotations for display, but the backend remains
the source of truth for study calculations.

## 4. Codebase Conventions

Preserve these current behaviors unless the task explicitly changes them:

- Maximum supported network size is 20 buses.
- Load-flow and short-circuit studies share the same persisted network graph.
- Persisted graph data must be sanitized before writing to localStorage.
- Transient result fields must not be persisted with the saved graph.
- The active node taxonomy is:
  - `bus`
  - `load`
  - `resistive_load`
  - `generator`
  - `utility`
  - `transformer`

When changing node data or study behavior, keep related frontend pieces in sync:
- default node data
- property editors
- payload mapping
- result annotation logic
- persistence sanitization
- Short-circuit canvas annotation context should stay in transient node fields only; if you add fault metadata for display, update both `sanitizeGraphForPersistence()` and the short-circuit/load-flow reset paths so saved diagrams do not retain study results.
- Protection-device inputs live under each node's persistent `data.protection` object on protection-eligible assets; if you change the protection model, update both the `ControlPanel.jsx` editor and `LoadFlowStudyPage.jsx` payload mapping together so backend validation receives the same structured fields the UI edits.
- Advanced-study validation should fail early in both layers: keep `LoadFlowStudyPage.jsx` preflight checks aligned with backend protection/short-circuit validation for disconnected assets, unsupported protection modes, and other study-blocking topology issues so the canvas clears stale results before the request and the backend still enforces the same rule set.
- Shared frontend study payload construction now lives in `frontend/src/utils/networkPayload.js`; extend `buildNetworkModel()` for base graph fields and the per-study builders there instead of adding another inline serializer in `LoadFlowStudyPage.jsx`.
- Study tabs that do not have backend calculation support yet should keep draft inputs and readiness state in local React state (`LoadFlowStudyPage.jsx` / `ControlPanel.jsx`) instead of persisting them on nodes, edges, or the shared network payload.
- Protection coordination responses now return validated device summaries plus a top-level `curves` array; keep future protection analysis and charting work aligned to that response shape instead of inventing a parallel payload.
- Protection coordination analysis feedback now lives under the shared response `analysis` object (`warning_count`, `warnings`, `scope_notes`); extend that block for future coordination checks instead of adding a second warnings payload in the frontend.
- Advanced-study validation now assumes short-circuit and protection coordination need an explicitly connected generator or utility source; keep frontend preflight checks in `LoadFlowStudyPage.jsx` aligned with backend source-reachability validation so users get the same actionable message before and after API requests.

When changing backend network models or result payloads, update the frontend
call sites and renderers in the same task.

## 5. Frontend Guidance

The main editor behavior currently lives in
`frontend/src/pages/LoadFlowStudyPage.jsx`. It is large and stateful.

Rules:
- Prefer focused changes over broad rewrites.
- Extract helpers or components when a change would otherwise make the page more
  tangled.
- Keep React Flow behavior consistent with existing interaction patterns.
- Preserve keyboard shortcuts, selection behavior, clipboard behavior, undo/redo,
  and context-menu flows unless the task explicitly changes them.
- Keep canvas result rendering readable; avoid mixing calculation logic directly
  into presentation code when a helper would do.

If you change what a node can edit or display, review:
- `frontend/src/components/ControlPanel.jsx`
- `frontend/src/components/SymbolNodes.jsx`
- `frontend/src/pages/LoadFlowStudyPage.jsx`
- Protection coordination charting currently lives in `frontend/src/components/ControlPanel.jsx` as a native SVG renderer fed by the backend `curves` array; extend that surface before adding a charting dependency or inventing a second result shape.

If you change study routing or app-level navigation, also review:
- `frontend/src/App.jsx`

## 6. Backend Guidance

The backend currently centers on `backend/main.py`.

Rules:
- Keep request and response models explicit with Pydantic.
- Keep shared network fields on the common backend `SharedNetworkInput` base model in `backend/main.py`, then layer study-specific request fields on explicit subclasses so load-flow, short-circuit, and protection stay aligned without changing the top-level payload shape.
- Validate bad bus references and impossible connections with clear HTTP 400
  errors.
- Keep calculation failures user-facing and concise.
- Preserve compatibility with the frontend payload shape unless the task
  intentionally changes that contract.
- When adding study inputs, add validation close to the model or network-build
  path rather than burying it in calculation code.
- When extending short-circuit results, preserve the generic `current_ka`
  aliases the frontend already renders and add method-aware `result_key` /
  `result_label` metadata or standard-specific fields alongside them rather
  than overloading `ikss_*` names.
- Advanced studies should not rely on the fallback auto-slack source created for generic load flow; short-circuit and protection coordination now require an explicitly connected generator or utility source and should fail clearly when the study bus is not source-reachable.

Transformer, generator, and short-circuit changes usually require coordinated
frontend and backend updates. Do not change only one side unless the task is
strictly internal.

Protection coordination notes:
- The backend derives TCC points from device settings plus calculated load-flow and short-circuit currents; avoid replacing those values with frontend-only demo data.
- Transformer-attached protection devices currently infer the protected side by comparing the configured pickup current against the transformer's rated HV and LV currents; keep that heuristic in mind if you extend transformer protection inputs.
- Shared backend sample networks for regression coverage live in `backend/test_study_samples.py`; extend those payload builders first when adding representative study verification so load-flow, short-circuit, and protection suites stay aligned on the same maintained fixtures.

## 7. Workflow Files

This repo contains planning and automation artifacts such as `tasks/`,
`progress.txt`, `skills/`, `ralph.md`, `ralph_once.sh`, and `ralph_loop.sh`.

Rules:
- Treat them as workflow support, not as the application architecture.
- Update them only when the task is explicitly about planning, automation, or
  reusable agent workflow.
- Do not assume older sample PRDs or instructions describe the live app; some
  are stale.

## 8. Code Quality Rules

Agents should:
- Prefer simple, local changes
- Reuse existing patterns before inventing new ones
- Keep names descriptive
- Avoid duplicating payload-shaping or result-formatting logic
- Add short comments only where the code is otherwise hard to follow

Avoid:
- speculative abstractions
- unrelated refactors
- silent behavior changes across both frontend and backend without verification

## 9. Verification

Before finishing a change, run the checks relevant to the files touched.

Typical checks:
- Frontend: `npm run build` from `frontend/`
- Backend: start/import the FastAPI app or run tests if present, using the repo-local `.venv` Python on Windows (`.venv\Scripts\python.exe`) because the system Python may not include `pandapower`

If study behavior changes, verify both:
- load-flow execution
- short-circuit execution

Use a minimal sample network when checking electrical-study behavior.

If a check cannot be run, say so clearly.

## 10. Dependency Rules

Do not add dependencies unless necessary.

If a dependency is added:
- explain why it is needed
- prefer mature, well-supported libraries
- keep the stack simple for local development

## 11. Security And Safety

Never hardcode:
- secrets
- tokens
- API keys

Do not weaken validation around electrical input data just to make a case pass.
Invalid networks should fail clearly.

## 12. Output Expectations

When completing work, include:
- what changed
- why it changed
- any checks run
- any important follow-up or remaining risks

Keep summaries concise and concrete.

## 13. General Philosophy

Prefer:
- clarity over cleverness
- incremental changes over rewrites
- shared understanding between frontend and backend contracts
- maintainable code over quick hacks

This repository is small enough that consistency matters more than abstraction.
