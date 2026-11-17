# ASCEND

**Become more. Every day.**

ASCEND is a personal operating system for iOS and Android: goals, tasks,
habits, an automatic daily scheduler, focus and study tracking, training,
reflection and insights, connected by an AI layer that proposes changes for
the user to approve.

## Status

**Stage 1 of 8 — product & architecture: complete.** No application code yet;
that begins in Stage 2.

| Document | Contents |
|---|---|
| [`docs/01-product.md`](docs/01-product.md) | What ASCEND is, the core loop, information architecture (5 tabs), product decisions |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Stack, local-first sync, security model, AI design, project structure, testing |
| [`docs/03-database.md`](docs/03-database.md) | Relational schema (~50 tables), conventions, RLS, storage, staging |
| [`docs/04-scheduler.md`](docs/04-scheduler.md) | The deterministic daily scheduler: algorithm, scoring, invariants |
| [`docs/05-roadmap.md`](docs/05-roadmap.md) | Stages 2–8, deliverables, acceptance-criteria mapping |
| [`docs/06-risks.md`](docs/06-risks.md) | Technical risks, mitigations, decisions needed |

## Stack (summary)

Expo SDK 58 (React Native 0.88, TypeScript), Expo Router, SQLite + Drizzle
(offline-first) with a custom sync engine, Supabase (Postgres with Row Level
Security, Auth, private Storage, Edge Functions), Claude via server-side Edge
Functions only.
