# OpenMark Router Testing Checklist

## Scope

This checklist is intentionally limited to validation that matters for the current router runtime:

- provider/default-model coverage
- classifier isolation
- same-session routing behavior
- restore behavior
- routed-model verification
- latency observation

Entries that do not directly validate those areas should stay out of this file.

## Environment Prep

- [ ] Build the plugin with `tsc -p tsconfig.json`.
- [ ] Restart the OpenClaw gateway after every router code change.
- [ ] Keep gateway logs open during every test run.
- [ ] Record the active `classifier_model`, `no_route_passthrough`, and user default model before each test batch.

## Baseline Smoke Tests

- [ ] Telegram `/new` bypasses routing and starts a clean session.
- [ ] Telegram routed request returns a routing card plus the routed-model answer in the same visible reply flow.
- [ ] Direct CLI request returns the routed-model answer on the same turn.
- [ ] Direct CLI second message in the same session still re-routes and preserves prior conversation context.

## Provider / Default Model Matrix

Run the same prompt set while changing the user's real default model before gateway startup.

- [ ] `google/gemini-3-flash-preview` as the user default model.
- [ ] An Anthropic default model.
- [ ] An OpenAI default model.
- [ ] At least one smaller / cheaper default model.
- [ ] Confirm startup captures the real user default into `.user_default_model`.
- [ ] Confirm the plugin still sets runtime default to `openmark/auto` after startup.
- [ ] Confirm routed answers still come from the recommended routed model, not the default model, when a route match exists.
- [ ] Confirm no-match requests still answer through the passthrough/default path.

## Classifier Isolation

Use a routeable prompt and inspect logs for the classifier call.

- [ ] Run with a strong classifier model and confirm classification still succeeds.
- [ ] Run with a small classifier model such as `gpt-nano`.
- [ ] Run with a small classifier model such as `gemini-3.1-flash-lite`.
- [ ] Confirm the classifier log line shows isolated simple-completion usage, not a full agent/provider rerun.
- [ ] Confirm classifier output stays short and category-like.
- [ ] Confirm classifier behavior does not change when the main agent session has long prior context.
- [ ] Confirm classifier behavior does not inherit full system instructions or session history from the main conversation turn.
- [ ] Confirm routing still refuses classifier recursion when the classifier resolves to `openmark/auto`.

## Same-Session Context

Use one session and send multiple related turns.

- [ ] First routed turn uses the recommended model.
- [ ] Second routed turn in the same session still sees the earlier user/assistant context.
- [ ] Mixed routing session: first message routes, second message is a no-match, third message routes again.
- [ ] Same-session Telegram flow preserves context across routed turns.
- [ ] Same-session CLI flow preserves context across routed turns.
- [ ] No stale model binding keeps later turns pinned to the previous routed model unintentionally.

## Restore Behavior

- [ ] After a routed Telegram turn, runtime default returns to `openmark/auto`.
- [ ] After a routed CLI turn, runtime default returns to `openmark/auto`.
- [ ] Compatibility fallback path restores to `openmark/auto` after the timer window.
- [ ] Startup clears stale conversation model bindings.
- [ ] A fresh message after restore is routed again instead of silently sticking to the previous routed model.

## Routed-Model Verification

- [ ] For Telegram, confirm logs show `before_dispatch reply selected ...` for the routed model.
- [ ] For CLI, confirm logs show `provider overridden` / `model overridden` to the routed model before run start.
- [ ] Confirm the embedded run start line shows the routed provider/model, not `openmark/auto`, for direct CLI turns.
- [ ] Confirm the final assistant text corresponds to that routed run.
- [ ] Confirm fallback candidates are present when the recommendation includes them.
- [ ] Force or simulate a primary-model failure and confirm fallback selection moves to the next configured candidate.

## Bypass / Internal Prompt Protection

- [ ] Slash commands such as `/new` and `/reset` bypass routing.
- [ ] Internal prompts such as slug generation bypass routing.
- [ ] Short messages under the routing threshold do not trigger classifier work.
- [ ] Provider self-recursion is blocked for classifier and passthrough paths.

## Latency

Record rough timings from logs and from the visible user experience.

- [ ] Measure classification latency alone.
- [ ] Measure full Telegram routed-turn latency.
- [ ] Measure full CLI routed-turn latency.
- [ ] Compare latency with a larger classifier model versus a smaller classifier model.
- [ ] Note whether route-preview Python calls are a noticeable portion of total latency.
- [ ] Note whether same-session turns are faster or slower than first-turn runs.
- [ ] Record any obvious improvement ideas discovered during testing.

## Suggested Prompt Set

- [ ] Scam email / phishing prompt.
- [ ] Coding prompt expected to route to a coding benchmark category.
- [ ] General no-match prompt expected to stay on passthrough/default.
- [ ] Follow-up prompt in the same session that depends on previous context.

## Release Cleanup

- [ ] Remove unnecessary files, temporary diagnostics, and dead logic before release.
