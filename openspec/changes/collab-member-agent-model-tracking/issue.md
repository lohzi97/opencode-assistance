# E2E Test Findings

## No Issues: Spawned session agent/model/variant is consistent across rooms

- **Severity:** None
- **Date:** 20260531
- **What happened:** A spawned `sebastian-clone` session with explicit `--agent sebastian-clone --provider zai-coding-plan --model glm-4.7` reported identical agent/provider/model/variant across two sequential rooms. The session was first spawned into room 1, then removed when room 1 was closed, then re-added to room 2 via `member add`, then removed again when room 2 was closed.
- **Expected:** The member row's stored agent/model/variant should be passed on every `promptAsync` delivery, preventing the session from reverting to system defaults.
- **Evidence:**

  | Step | Session | Agent | Provider | Model | Variant |
  |---|---|---|---|---|---|
  | Clone in room 1 (spawned) | `ses_1865d8c80ffeMwZ8jHG9044hA4` | sebastian-clone | zai-coding-plan | glm-4.7 | (empty) |
  | Clone in room 2 (re-added via member add) | `ses_1865d8c80ffeMwZ8jHG9044hA4` | sebastian-clone | zai-coding-plan | glm-4.7 | (empty) |

  Both readings are identical and match the spawn-time parameters exactly.

- **Affected requirement:** `member-agent-model` requirement "Member agent/model is used on every delivery", scenarios for buffered and immediate delivery.
- **Recommended follow-up:** None required. The `member-agent-model` tracking is working correctly for the spawn and member-add paths.

## HIGH: Planner model shifts after receiving collab deliveries due to missing founder capture path

- **Severity:** HIGH
- **Date:** 20260531
- **What happened:** The planner session (Sebastian, `ses_1865e3facffevMx3bbeyK50CPM`) reported `openai/gpt-5.5` before entering a collab room. After the collab service delivered clone messages into the planner's session, the planner's effective model shifted to `zai-coding-plan/glm-5.1`. The model change persisted through all subsequent readings.
- **Expected:** Collab deliveries to the planner session should preserve the planner's existing agent/model/variant. The planner's model should remain `openai/gpt-5.5` throughout the room interaction.
- **Evidence:**

  | Step | Planner Provider | Planner Model |
  |---|---|---|
  | 1. Before room 1 | openai | gpt-5.5 |
  | 5. After room 1 close | zai-coding-plan | glm-5.1 |
  | 9. After room 2 close | zai-coding-plan | glm-5.1 |

- **Root cause:** The proposal's design (D2) covers three membership paths for agent/model capture: spawn, member add, and self-join. The **room-creation founder path** is a fourth path that is not covered. When a planner creates a room, `createRoom()` auto-joins the planner as the first member via `insertMember()` without querying or storing the planner's current agent/model/variant. The planner's member row stores `NULL` for all agent/model columns.

  When the delivery engine later injects clone messages into the planner's session, it looks up the planner's member row and finds `NULL` agent/model. Per design D3 fallback, `NULL` causes the delivery to omit agent/model from the `promptAsync` call. OpenCode then resolves the model to its default agent's configured model (`zai-coding-plan/glm-5.1`) instead of preserving the planner's session model (`openai/gpt-5.5`).

  This is the exact same class of bug that the proposal describes for spawned sessions, but applied to the planner who created the room.

- **Affected requirement:** `member-agent-model` requirement "Member agent/model is used on every delivery". `collab-core` requirement for planner-managed membership (room creation founder auto-join path).
- **Recommended follow-up:** Add agent/model capture to the room-creation founder path. `createRoom()` should query the planner session's last user message (same approach as `member add` and `self-join`) and store the resolved agent/model/variant on the founder's member row. This closes the fourth membership path and ensures the planner's identity is preserved on all inbound collab deliveries.
