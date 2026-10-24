# Contributing to Diffloupe

Thank you for helping. This guide explains how to build Diffloupe, how to test it, and how a change is accepted.

## Before you start

Open an issue first for anything larger than a small fix, so we can agree on the change before you build it.

By sending a pull request, you give the maintainer, Georgi Staykov, a perpetual, worldwide, royalty-free and irrevocable license to use, change, distribute and relicense your contribution, including in Diffloupe's releases. You also confirm that you wrote the contribution or have the right to give this license, for example with your employer's permission. You keep the copyright of your contribution.

## Build and test

You need a Mac with Apple silicon, the Xcode Command Line Tools, Rust (through rustup), Node 22, pnpm and Python 3.

```bash
pnpm install
pnpm dev          # the app, with hot reload
pnpm dev:bridge   # the same UI in a browser, served by the dev bridge
pnpm test         # Rust and UI unit tests
pnpm e2e          # Playwright UI tests through the dev bridge
pnpm lint         # rustfmt, clippy, Biome and the TypeScript check
```

The Rust core and the Tauri shell live in `backend/`, the React UI in `frontend/`, and the website in `website/`, which has its own commands in its folder. [AGENTS.md](AGENTS.md) holds the rules for everyone who changes this repository, human or agent: the architecture, the code and test rules, and how releases keep users' data.

## Send a change

- Work on a branch, and keep each change to one topic.
- Every change ships with tests: unit tests, integration tests for the core, and UI tests for user flows.
- Run `pnpm lint`, `pnpm test` and `pnpm e2e` before you push. All three must pass.
- Write commit messages as one short sentence.
- Open a pull request and describe what changes for the person who uses Diffloupe. The maintainer reviews it and runs the checks before merging.
