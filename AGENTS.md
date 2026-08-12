# MusicGameDemo Agent Instructions

## Required reading before work

Before analysing, changing, testing, or deploying this repository, read these files in order:

1. `README.md` for the project entry point, branch, commands, and delivery rule.
2. `docs/README.md` for document ownership and the minimum document set for a change.
3. The document matching the task: `docs/简化玩法策划案（原型版）.md` for current player-visible rules, `docs/实机落地与调整记录.md` for code facts and acceptance, `docs/资源与素材规范.md` for assets, and `docs/2D音乐弹幕游戏策划案 (持续更新).md` only for long-term design.
4. The affected source code. When documentation conflicts with code, code and the “当前实机规则” section are authoritative; report and repair the stale documentation in the same change.

Do not treat the long-term design document or historical update notes as evidence that a feature is implemented.

## Change contract

- Use `dev-1.0` for development unless the user explicitly selects another branch. Do not overwrite a dirty worktree.
- Every gameplay, input, parameter, audio, animation, runtime asset, engineering, or deployment change must include a dated entry under `docs/更新记录/` and an update to `docs/实机落地与调整记录.md`.
- Also update `docs/简化玩法策划案（原型版）.md` when a player can perceive the changed rule; update the long-term design only when its product target changes. Update `README.md` for branch, build, deployment, project-entry, or current-snapshot changes.
- Runtime assets belong only in `public/assets/`: images in `images/`, SFX in `audio/sfx/`, and BGM in `audio/music/`. Use `import.meta.env.BASE_URL`; do not hard-code `/assets/` paths. Follow the full asset acceptance procedure in `docs/资源与素材规范.md`.
- Keep `dist/`, `node_modules/`, screenshots, downloaded leftovers, and unreferenced temporary exports out of commits.

## Verification and handoff

- Run `npm ci` when dependency state must be refreshed and run `npm run build` for every code, asset, or configuration change.
- For gameplay or assets, perform the applicable checks in `docs/实机落地与调整记录.md` section 7; verify browser console and resource loading when a browser is available.
- After every completed change, confirm that the local development server is reachable and include the actual local play URL in the final handoff. Default to `http://127.0.0.1:5173/`; if another port is used, report that exact port. If the server cannot be started, state the reason instead of omitting the link.
- Report the branch, commit, changed files, verification result, and any remaining documentation/code conflict.

These instructions govern agents that support repository instruction discovery (including Codex). Agents or tools that do not load repository instructions cannot be technically forced by this file; direct them to read this file before work.
