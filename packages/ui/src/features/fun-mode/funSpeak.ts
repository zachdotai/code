import type { FunMode } from "@posthog/ui/features/settings/settingsStore";
import {
  LOLCAT_OVERRIDES,
  LOLCAT_SENTENCE_RULES,
  LOLCAT_WORD_RULES,
} from "./rules/lolcat";
import { PIRATE_OVERRIDES, PIRATE_WORD_RULES } from "./rules/pirate";

type WordRule = readonly [RegExp, string];
type SentenceRule = (s: string) => string;

interface RuleSet {
  overrides: Record<string, string>;
  words: ReadonlyArray<WordRule>;
  sentence: ReadonlyArray<SentenceRule>;
}

const PIRATE: RuleSet = {
  overrides: PIRATE_OVERRIDES,
  words: PIRATE_WORD_RULES,
  sentence: [],
};

const LOLCAT: RuleSet = {
  overrides: LOLCAT_OVERRIDES,
  words: LOLCAT_WORD_RULES,
  sentence: LOLCAT_SENTENCE_RULES,
};

function preserveCase(match: string, replacement: string): string {
  if (match.length > 1 && match === match.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (match[0] === match[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function apply(text: string, rules: RuleSet): string {
  const override = rules.overrides[text];
  if (override !== undefined) return override;
  let out = text;
  for (const [re, repl] of rules.words) {
    out = out.replace(re, (match) => preserveCase(match, repl));
  }
  for (const fn of rules.sentence) {
    out = fn(out);
  }
  return out;
}

export function funSpeak(text: string, mode: FunMode): string {
  if (mode === "none" || !text) return text;
  if (mode === "pirate") return apply(text, PIRATE);
  if (mode === "lolcat") return apply(text, LOLCAT);
  return text;
}
