# Structured Validation Criteria + Hedgehog-Themed Nest Phases

## Problem

Nests currently have a flat `definitionOfDone: string | null` that gates `working → validating`. Two problems:

1. **Quick nests never reach validating.** They have `definitionOfDone: null`, so even when all hoglets finish, the nest stays stuck in `working` forever (see `nestLifecycle.ts:58`).
2. **No structured tracking.** The DoD is prose — there's no way to track which parts are met. The goal draft produces `successCriteria` with IDs but that data is baked into the `goalPrompt` markdown and thrown away at creation time.
3. **Validation is manual.** The hedgehog has no tool to mark anything as done. The operator must eyeball everything and click "Mark validated."

Meanwhile, the success criteria from the spec (SC-001, SC-002...) describe *what to build*, but the definition of done often contains the actual *validation gates* — e.g., "5 unique PostHog survey responses collected." These are the items we need to track, and they live in the DoD, not the SC list.

## Solution

1. Add **structured validation criteria** persisted on the nest as a JSON column
2. Have the **goal draft service produce concrete, measurable validation items** from the DoD
3. Give the **hedgehog a `mark_criterion_met` tool** so it checks off items automatically as it observes evidence
4. Introduce **hedgehog-themed lifecycle phases** with a new "Denned Up" intermediate state

## Lifecycle Phases

```
scouting    → no hoglets yet (was "planning")
foraging    → hoglets actively building (was "working")
denned_up   → all hoglets terminal, criteria tracking shows progress (NEW)
validating  → all criteria met, awaiting operator sign-off
validated   → operator confirmed (unchanged)
dormant     → compacted (unchanged)
archived    → cancelled (unchanged)
```

The old DoD-null gate (`nestLifecycle.ts:58`) is removed entirely. Instead:
- All hoglets terminal + no criteria → `denned_up` (operator can validate directly)
- All hoglets terminal + some criteria open → `denned_up` (shows "2/5 met")
- All hoglets terminal + all criteria met → `validating`

---

## Implementation Details

### Phase 1: Data Layer

#### 1a. DB migration
**New file:** `apps/code/src/main/db/migrations/0016_validation_criteria.sql`
```sql
ALTER TABLE `hedgemony_nest` ADD COLUMN `validation_criteria_json` text;
```
SQLite `ALTER TABLE ADD COLUMN` defaults to null. No index needed — criteria are always read alongside the nest row. After creating this file, run `pnpm db:generate` for the Drizzle snapshot.

#### 1b. Drizzle schema
**File:** `apps/code/src/main/db/schema.ts`
**Location:** line 118, after the `loadoutJson` column in the `hedgemonyNests` table

Add:
```ts
validationCriteriaJson: text(),
```

#### 1c. Zod schemas
**File:** `apps/code/src/main/services/hedgemony/schemas.ts`

Add new types (near line 72, before the `nest` schema):
```ts
export const validationCriterion = z.object({
  id: z.string().trim().min(1).max(20),       // e.g. "VC-001"
  text: z.string().trim().min(1).max(500),     // concrete, measurable item
  met: z.boolean(),
  metAt: z.string().nullable(),                // ISO timestamp when marked met
  metBy: z.enum(["hedgehog", "operator"]).nullable(),
});
export type ValidationCriterion = z.infer<typeof validationCriterion>;

export const validationCriteriaSchema = z.array(validationCriterion).max(12);
export type ValidationCriteria = z.infer<typeof validationCriteriaSchema>;
```

Update the `nest` schema (line 72) to add:
```ts
validationCriteriaJson: z.string().nullable(),
```

Update `createNestInput` (line 167) to add:
```ts
validationCriteria: z.array(validationCriterion.omit({ met: true, metAt: true, metBy: true }).extend({
  met: z.boolean().optional(),
  metAt: z.string().nullable().optional(),
  metBy: z.enum(["hedgehog", "operator"]).nullable().optional(),
})).max(12).optional(),
```
(Or simpler: just accept the full `validationCriterion` array as optional. The service initializes `met: false` for new items anyway.)

Update `goalSpecDraftCore` (line 124) to add:
```ts
validationItems: z.array(z.object({
  id: z.string().trim().min(1).max(20),
  text: z.string().trim().min(1).max(500),
})).min(1).max(8).optional(),
```
This is optional so existing drafts without it still parse.

#### 1d. Parser function
**File:** `apps/code/src/main/services/hedgemony/schema-parsers.ts`

Follow the exact pattern of `parseNestLoadout` (line 19) and `parseScratchpadState` (line 44):
```ts
export function parseValidationCriteria(json: string | null): ValidationCriterion[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    schemaLog.warn("validationCriteria JSON.parse failed; returning empty", { ... });
    return [];
  }
  const result = validationCriteriaSchema.safeParse(raw);
  if (!result.success) {
    schemaLog.warn("validationCriteria shape rejected; returning empty", { ... });
    return [];
  }
  return result.data;
}
```

Key: `null` → `[]`, corrupt JSON → `[]`. Existing nests are safe.

This parser is also needed in the renderer for lifecycle derivation. Since `schema-parsers.ts` has no Node-specific dependencies and the renderer already imports from `@main/services/hedgemony/schemas`, it can be imported directly via `@main/services/hedgemony/schema-parsers`.

#### 1e. Nest repository
**File:** `apps/code/src/main/db/repositories/nest-repository.ts`

Add `validationCriteriaJson?: string | null` to:
- `CreateNestData` interface (line 17)
- `UpdateNestData` interface (line 26)

In `create()` (line 63), include in the row:
```ts
validationCriteriaJson: data.validationCriteriaJson ?? null,
```

#### 1f. Nest service
**File:** `apps/code/src/main/services/hedgemony/nest-service.ts`

In `create()` (line 59), serialize criteria from input:
```ts
validationCriteriaJson: input.validationCriteria
  ? JSON.stringify(input.validationCriteria.map(c => ({
      ...c, met: false, metAt: null, metBy: null,
    })))
  : null,
```

Add a new method:
```ts
markCriterionMet(nestId: string, criterionId: string, evidence: string, by: "hedgehog" | "operator"): { success: boolean; error?: string } {
  const nest = this.nests.findById(nestId);
  if (!nest) return { success: false, error: "Nest not found" };
  const criteria = parseValidationCriteria(nest.validationCriteriaJson);
  const criterion = criteria.find(c => c.id === criterionId);
  if (!criterion) return { success: false, error: `Criterion ${criterionId} not found` };
  if (criterion.met) return { success: true }; // idempotent
  criterion.met = true;
  criterion.metAt = new Date().toISOString();
  criterion.metBy = by;
  this.nests.update(nestId, { validationCriteriaJson: JSON.stringify(criteria) });
  // Emit status event so renderer picks up the change
  const updated = this.nests.findById(nestId);
  if (updated) this.emitChange(updated, { kind: "status", nest: updated });
  return { success: true };
}
```

---

### Phase 2: Goal Draft Service — Structured DoD Items

#### 2a. System prompt
**File:** `apps/code/src/main/services/hedgemony/goal-spec-draft-service.ts`
**Location:** `SYSTEM_PROMPT` constant (line 29)

Add `"validationItems"` to the JSON shape documentation:
```
"validationItems":[{"id":"VC-001","text":"Concrete measurable criterion"}]
```

Add guidance rules:
```
- validationItems must be concrete, measurable, and independently verifiable. Each item should be something the hedgehog can observe evidence for — e.g. "At least 5 unique PostHog survey responses collected and verifiable in PostHog" rather than "surveys work correctly". The hedgehog will mark these met during execution.
- Keep definitionOfDone as a one-sentence summary. validationItems are the structured checklist underneath it.
- Extract validation items from the DoD, not from success criteria. Success criteria describe what to build; validation items describe how to confirm it's truly done.
```

#### 2b. Array clamping
**File:** same, `clampDraftArrays()` (line 289)
Add to the limits object:
```ts
validationItems: 8,
```

#### 2c. goalPrompt rendering
**File:** same, `buildGoalPrompt()` (line 382)

Add a "## Validation Items" section after Success Criteria if `draft.validationItems` is non-empty:
```ts
const validationItemsSection = draft.validationItems?.length
  ? draft.validationItems.map(item => `- ${item.id}: ${item.text}`).join("\n")
  : null;
```
Include in the returned array if non-null.

#### 2d. PlaceNestDialog
**File:** `apps/code/src/renderer/features/hedgemony/components/PlaceNestDialog.tsx`
**Location:** `handleSubmit` function (around line 184)

When building the `nests.create` mutation payload, pass validation items from the draft:
```ts
validationCriteria: !simpleMode && draft?.validationItems
  ? draft.validationItems.map(item => ({
      id: item.id,
      text: item.text,
      met: false,
      metAt: null,
      metBy: null,
    }))
  : undefined,
```

For quick/simple nests, `validationCriteria` is undefined → column stays null → parser returns `[]`.

---

### Phase 3: Hedgehog Tool — `mark_criterion_met`

#### 3a. Tool definition
**File:** `apps/code/src/main/services/hedgemony/hedgehog-tools.ts`

Add to `HEDGEHOG_TOOLS` array (after the `rebase_child` entry at line 202):
```ts
{
  name: "mark_criterion_met",
  description:
    "Mark a validation criterion as met. Use when you have observed concrete evidence that a criterion is satisfied — e.g. a hoglet's PR implements the required behavior, tests pass, or the work output matches the criterion text. Do not mark speculatively.",
  input_schema: {
    type: "object",
    properties: {
      criterion_id: {
        type: "string",
        description: "The id of the validation criterion (e.g. 'VC-001').",
      },
      evidence: {
        type: "string",
        description: "Brief description of the evidence you observed. Surfaced to the operator in the audit log.",
      },
    },
    required: ["criterion_id", "evidence"],
  },
},
```

Update `HedgehogToolName` union (line 205) to include `"mark_criterion_met"`.

Add Zod args schema:
```ts
export const markCriterionMetArgs = z.object({
  criterion_id: z.string().min(1).max(20),
  evidence: z.string().trim().min(1).max(2000),
});
export type MarkCriterionMetArgs = z.infer<typeof markCriterionMetArgs>;
```

#### 3b. Handler
**New file:** `apps/code/src/main/services/hedgemony/hedgehog-handlers/mark-criterion-met-handler.ts`

Follow the `write-audit-entry-handler.ts` pattern exactly:
```ts
import { markCriterionMetArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, truncate } from "./utils";

export const markCriterionMetHandler: HedgehogToolHandler = {
  name: "mark_criterion_met",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = markCriterionMetArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(deps, ctx.nest.id, "mark_criterion_met", parsed.error.message);
    }
    const { criterion_id, evidence } = parsed.data;
    const result = deps.markCriterionMet(ctx.nest.id, criterion_id, evidence);
    if (!result.success) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "tool_result",
        body: `mark_criterion_met failed: ${result.error}`,
        visibility: "summary",
      });
      return { success: false, scratchpadSummary: `mark_criterion_met failed: ${result.error}` };
    }
    deps.writeNestMessage(ctx.nest.id, {
      kind: "audit",
      body: `Criterion ${criterion_id} marked met: ${truncate(evidence, 200)}`,
      visibility: "summary",
      payloadJson: { type: "criterion_met", criterionId: criterion_id, evidence },
    });
    return {
      success: true,
      scratchpadSummary: `criterion ${criterion_id} met: ${truncate(evidence, 80)}`,
    };
  },
};
```

#### 3c. Handler dependencies
**File:** `apps/code/src/main/services/hedgemony/hedgehog-handlers/types.ts`

Add to `HedgehogToolDeps` interface (line 41):
```ts
markCriterionMet(nestId: string, criterionId: string, evidence: string): { success: boolean; error?: string };
```

**File:** `apps/code/src/main/services/hedgemony/hedgehog-tick-service.ts`
**Location:** `buildHandlerDeps()` method (line 463)

Add:
```ts
markCriterionMet: (nestId, criterionId, evidence) =>
  this.nestService.markCriterionMet(nestId, criterionId, evidence, "hedgehog"),
```

(`this.nestService` is already injected — it's the `NestService` used throughout the tick service.)

#### 3d. Registry
**File:** `apps/code/src/main/services/hedgemony/hedgehog-handlers/registry.ts`

Import and add to `handlerList`:
```ts
import { markCriterionMetHandler } from "./mark-criterion-met-handler";
// ...
const handlerList: readonly HedgehogToolHandler[] = [
  // ...existing handlers...
  markCriterionMetHandler,
];
```

---

### Phase 4: Hedgehog Tick Context — Criteria in Prompt

#### 4a. System prompt update
**File:** `apps/code/src/main/services/hedgemony/hedgehog-prompts.ts`
**Location:** `HEDGEHOG_SYSTEM_PROMPT` (line 45)

- Change "nine tools" → "ten tools" and add `mark_criterion_met` to the list
- Add to the guidance: "When all hoglets are terminal and you can see evidence that a validation criterion is met, call mark_criterion_met with the criterion ID and a brief description of the evidence. Only mark criteria you have concrete evidence for — do not mark speculatively. When all criteria are met, the nest transitions to validating and the operator can confirm."

#### 4b. User prompt — criteria section
**File:** same, `buildUserPrompt()` (line 76)

Add a new section between the goal section and the loadout section:
```ts
const criteriaSection = (() => {
  const criteria = parseValidationCriteria(nest.validationCriteriaJson ?? null);
  if (criteria.length === 0) return "";
  const metCount = criteria.filter(c => c.met).length;
  const lines = [
    `## Validation criteria (${metCount}/${criteria.length} met)`,
    ...criteria.map(c =>
      `- ${c.id}: ${c.met ? "[MET]" : "[OPEN]"} ${c.text}${c.met && c.metAt ? ` (met ${c.metAt})` : ""}`
    ),
  ];
  return lines.join("\n");
})();
```

Import `parseValidationCriteria` from `./schema-parsers`.

Include `criteriaSection` in the final array passed to `.join("\n\n")` (line 258). No interface changes needed since `nest: Nest` already has `validationCriteriaJson` after the Zod schema update.

---

### Phase 5: Lifecycle Derivation

#### 5a. New lifecycle type and derivation
**File:** `apps/code/src/renderer/features/hedgemony/utils/nestLifecycle.ts`

Replace the type (line 18):
```ts
export type NestLifecycle =
  | "scouting"
  | "foraging"
  | "denned_up"
  | "validating"
  | "validated"
  | "dormant"
  | "archived";
```

Update `DeriveNestLifecycleArgs` (line 32) — nest Pick needs `validationCriteriaJson`:
```ts
nest: Pick<Nest, "status" | "definitionOfDone" | "validationCriteriaJson">;
```

New derivation logic (replaces lines 38-61):
```ts
export function deriveNestLifecycle({ nest, hoglets, taskStatusFor }: DeriveNestLifecycleArgs): NestLifecycle {
  if (nest.status === "archived") return "archived";
  if (nest.status === "dormant") return "dormant";
  if (nest.status === "validated") return "validated";

  // active | needs_attention from here

  if (hoglets.length === 0) return "scouting";

  const allTerminal = hoglets.every(h => TERMINAL_STATUSES.has(taskStatusFor(h.taskId)));
  if (!allTerminal) return "foraging";

  // All hoglets terminal from here
  const criteria = parseValidationCriteria(nest.validationCriteriaJson ?? null);
  if (criteria.length === 0) return "denned_up";  // quick nests, or nests without criteria
  const allMet = criteria.every(c => c.met);
  return allMet ? "validating" : "denned_up";
}
```

Import `parseValidationCriteria` from `@main/services/hedgemony/schema-parsers`.

**Key behavioral changes:**
- The old `if (!nest.definitionOfDone) return "working"` gate is **removed**
- Quick nests now reach `denned_up` when all hoglets finish (instead of being stuck in `working`)
- The `working` string literal no longer exists
- `denned_up` is the new intermediate state — criteria progress is shown here

#### 5b. Tests
**File:** `apps/code/src/renderer/features/hedgemony/utils/nestLifecycle.test.ts`

The `NestStub` type (line 6) needs `validationCriteriaJson`:
```ts
type NestStub = Pick<Nest, "status" | "definitionOfDone" | "validationCriteriaJson">;
```

The `nest()` helper (line 9) needs to include it:
```ts
const nest = (
  status: Nest["status"],
  definitionOfDone: string | null = "Goal is met.",
  validationCriteriaJson: string | null = null,
): NestStub => ({ status, definitionOfDone, validationCriteriaJson });
```

Rewrite all test cases to use new phase names:
- `"planning"` → `"scouting"`
- `"working"` → `"foraging"`

Add new test cases:
- `denned_up` when all hoglets terminal + no criteria (null JSON)
- `denned_up` when all hoglets terminal + partial criteria met
- `validating` when all hoglets terminal + all criteria met
- Quick nest (null DoD, null criteria) reaches `denned_up` when hoglet finishes

---

### Phase 6: UI Updates

#### 6a. NestSprite
**File:** `apps/code/src/renderer/features/hedgemony/components/NestSprite.tsx`

Update `LIFECYCLE_LABEL` (line 80):
```ts
const LIFECYCLE_LABEL: Record<NestLifecycle, string> = {
  scouting: "Scouting",
  foraging: "Foraging",
  denned_up: "Denned Up",
  validating: "Validating",
  validated: "Validated",
  dormant: "Dormant",
  archived: "Archived",
};
```

Update `territoryBackground()` (line 59):
- `case "scouting":` → cyan gradient (was `planning`)
- `case "foraging":` → default/orange (was `working`)
- `case "denned_up":` → warm amber gradient:
  ```ts
  return "radial-gradient(circle, rgba(251, 191, 36, 0.22) 0%, rgba(251, 191, 36, 0.10) 42%, transparent 72%)";
  ```

Update `LifecycleBadge` (line 89):
- Add `denned_up` case with a Moon or House icon in amber

Update label display condition (line 312):
```ts
// was: lifecycle !== "working" && lifecycle !== "archived"
lifecycle !== "foraging" && lifecycle !== "archived"
```

#### 6b. NestDetailPanel
**File:** `apps/code/src/renderer/features/hedgemony/components/NestDetailPanel.tsx`

**New: criteria checklist component** — add after the lifecycle alerts (around line 280). Parse `nest.validationCriteriaJson`, show progress bar/counter and a list of criteria with met/open icons.

**New: `denned_up` alert** — amber banner:
```tsx
{lifecycle === "denned_up" && (
  <div className="rounded-(--radius-2) border border-(--amber-7) bg-(--amber-2) p-3">
    {/* Icon + "Denned Up" heading */}
    {criteria.length > 0
      ? `All hoglets finished. ${metCount}/${criteria.length} criteria met.`
      : "All hoglets finished. No structured criteria to check."}
    {/* For nests with no criteria, show "Mark validated" button directly */}
  </div>
)}
```

**Update `validating` alert** (line 281):
Change copy from "All hoglets finished and the definition of done is set" to "All hoglets finished and all validation criteria met. Review and confirm the goal is done."

**Update editable condition** (line 115):
```ts
const editable = lifecycle === "scouting" || lifecycle === "foraging";
```

**Update chat composer condition** (line 116):
Update `dormant`/`archived` check to use new names (these didn't change, so this should still work).

#### 6c. MarkValidatedDialog
**File:** `apps/code/src/renderer/features/hedgemony/components/MarkValidatedDialog.tsx`

Update default summary to include criteria status when criteria exist.

---

### Grep checklist — lifecycle string literals to update

These are all the renderer files that reference the old lifecycle names. Every occurrence needs updating:

```
nestLifecycle.ts:19-20      — type definition ("planning", "working")
nestLifecycle.ts:51,56,58   — return values
nestLifecycle.test.ts       — all assertions
NestSprite.tsx:71,73,80-87  — LIFECYCLE_LABEL, territoryBackground cases
NestSprite.tsx:312           — label display condition ("working")
NestDetailPanel.tsx:115      — editable condition ("planning", "working")
NestDetailPanel.tsx:281      — validating alert
```

Run `grep -rn '"planning"\|"working"' apps/code/src/renderer/features/hedgemony` after changes to verify nothing is missed.

---

### Backward Compatibility

- `validationCriteriaJson` defaults to `null` → `parseValidationCriteria(null)` returns `[]`
- Existing nests with DoD string but no criteria → reach `denned_up` when all hoglets terminal (previously reached `validating`). Operator can still "Mark validated" directly from `denned_up` when criteria list is empty.
- Existing nests still in `working` due to null DoD → will now reach `denned_up` once all hoglets finish. This is the intended fix.
- The `definitionOfDone` text string is preserved and still displayed in the UI. Criteria are additive.

---

### Verification

1. `pnpm typecheck` — all lifecycle references compile with new names
2. `pnpm --filter code test` — lifecycle tests pass with new phases
3. `pnpm dev:code` — create a guided nest, verify criteria appear in detail panel
4. Create a quick nest — verify it reaches "Denned Up" when hoglet finishes
5. Trigger a hedgehog tick on a nest with criteria — verify `mark_criterion_met` tool is available and criteria section appears in the tick prompt
6. Verify existing nests without criteria still work (backward compat)

### Sequencing

```
Phase 1 (data layer)           — do first, everything depends on it
Phase 2 (draft service)        — can parallel with Phase 3
Phase 3 (hedgehog tool)        — can parallel with Phase 2
Phase 4 (tick context)         — depends on Phase 1
Phase 5 (lifecycle derivation) — depends on Phase 1, riskiest change
Phase 6 (UI updates)           — depends on Phase 5
```
