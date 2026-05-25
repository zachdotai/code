import type {
  AddOnConfig,
  AddOnContext,
  AddOnContribution,
  AddOnDefinition,
} from "./types";

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-definition option types
type AnyAddOnDefinition = AddOnDefinition<any>;

export class AddOnRegistry {
  private definitions = new Map<string, AnyAddOnDefinition>();

  register<TOptions>(definition: AddOnDefinition<TOptions>): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(
        `AddOn "${definition.name}" is already registered. Names must be unique.`,
      );
    }
    this.definitions.set(definition.name, definition);
  }

  get(name: string): AnyAddOnDefinition | undefined {
    return this.definitions.get(name);
  }

  list(): AnyAddOnDefinition[] {
    return [...this.definitions.values()];
  }

  /**
   * Resolve every enabled add-on for the current adapter and merge their
   * contributions into a single object. Unknown names, unsupported adapters,
   * and option-parse failures are logged and skipped — never throw out of
   * `collect()`, since one misconfigured add-on should not break the session.
   * `prepare()` failures DO throw, because they signal a missing prerequisite
   * the user must fix.
   */
  async collect(
    config: AddOnConfig | undefined,
    ctx: AddOnContext,
  ): Promise<AddOnContribution> {
    const merged: AddOnContribution = {};
    if (!config) return merged;

    for (const [name, rawOptions] of Object.entries(config)) {
      const definition = this.definitions.get(name);
      if (!definition) {
        ctx.logger.warn(`Unknown add-on "${name}" — skipping`, {
          addOn: name,
        });
        continue;
      }

      if (
        definition.supportedAdapters &&
        !definition.supportedAdapters.includes(ctx.adapter)
      ) {
        ctx.logger.info(
          `Add-on "${name}" is not supported on adapter "${ctx.adapter}" — skipping`,
          { addOn: name, adapter: ctx.adapter },
        );
        continue;
      }

      let options: unknown;
      try {
        options = definition.parseOptions(rawOptions ?? {});
      } catch (error) {
        ctx.logger.warn(`Add-on "${name}" rejected options — skipping`, {
          addOn: name,
          error,
        });
        continue;
      }

      if (definition.prepare) {
        await definition.prepare(ctx, options);
      }

      const contribution = await definition.contribute(ctx, options);
      mergeContribution(merged, contribution);
    }

    return merged;
  }
}

function mergeContribution(
  target: AddOnContribution,
  source: AddOnContribution,
): void {
  if (source.env) {
    target.env = { ...(target.env ?? {}), ...source.env };
  }
  if (source.systemPromptAppend) {
    target.systemPromptAppend =
      (target.systemPromptAppend ?? "") + source.systemPromptAppend;
  }
  if (source.preToolUse?.length) {
    target.preToolUse = [...(target.preToolUse ?? []), ...source.preToolUse];
  }
  if (source.postToolUse?.length) {
    target.postToolUse = [...(target.postToolUse ?? []), ...source.postToolUse];
  }
}
