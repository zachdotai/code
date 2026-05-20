export const SPEC_DRIVEN_DEVELOPMENT_METHOD = "spec-driven-development";

export const SPEC_DRIVEN_GOAL_DESIGN_GUIDANCE = `Use a spec-driven-development shape for Hedgemony nest goals:
- Keep the goal focused on WHAT and WHY before HOW. Avoid implementation details unless the operator explicitly gives hard constraints.
- Prefer a lightweight feature specification structure: operator scenario, prioritized user stories, independently testable acceptance scenarios, functional requirements, key entities, assumptions, and measurable success criteria.
- Preserve those sections as explicit structured fields so the app can render and persist a stable Markdown spec.
- Mark important ambiguity as a clarifying question before drafting instead of guessing.
- The definition of done should be testable and measurable. It should cover validation evidence, not just code completion.
- Keep implementation planning separate. The nest goal can mention known constraints, but the hedgehog should later turn the accepted spec into concrete plans and hoglet tasks.`;
