## MODIFIED Requirements

### Requirement: Spawn prompt ordering is bootstrap first
The spawned member SHALL receive join bootstrap before the spawn `initial_prompt`, as required by PRD lines 606-607. The join bootstrap SHALL use the resolved `collab.room_join_instruction` content, and the spawn `initial_prompt` SHALL remain a separate post-bootstrap `spawn_initial` delivery when present.

#### Scenario: Bootstrap succeeds before initial prompt
- **WHEN** a spawned member has both bootstrap and initial prompt pending
- **THEN** delivery injects bootstrap first and initial prompt only after bootstrap is delivered

#### Scenario: Room join instruction and initial prompt are not merged
- **WHEN** both room join instruction and spawn initial prompt are present
- **THEN** the room join instruction is delivered in the `join_bootstrap` prompt and the initial prompt is delivered separately in the later `spawn_initial` prompt

#### Scenario: Empty initial prompt skips spawn initial delivery
- **WHEN** spawn has no `initial_prompt`
- **THEN** no `spawn_initial` delivery is created

## REMOVED Requirements

### Requirement: Spawn instruction is template-rendered
**Reason**: The configurable instruction now belongs to room join/bootstrap behavior, not spawn-specific follow-up behavior.
**Migration**: Configure `collab.room_join_instruction` instead. The same template variables remain available: `{room}`, `{alias}`, `{role}`, and `{from}`.
