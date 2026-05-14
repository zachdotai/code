export type StarAxis =
  | "marketing"
  | "operations"
  | "product"
  | "design"
  | "hr"
  | "finance"
  | "legal";

export const AXIS_ORDER: StarAxis[] = [
  "marketing",
  "operations",
  "product",
  "design",
  "hr",
  "finance",
  "legal",
];

export const AXIS_LABEL: Record<StarAxis, string> = {
  marketing: "Marketing",
  operations: "Operations",
  product: "Product",
  design: "Design",
  hr: "HR",
  finance: "Finance",
  legal: "Legal",
};

export type SkillTag =
  | "product"
  | "growth"
  | "sales"
  | "customer"
  | "reporting";

export interface StarMapInput {
  title: string;
  description: string;
  tags: SkillTag[];
}

export interface StarMapScores {
  axes: Record<StarAxis, number>;
  founder: number;
  max: number;
  total: number;
}

const AXIS_KEYWORDS: Record<StarAxis, string[]> = {
  marketing: [
    "marketing",
    "campaign",
    "content",
    "social",
    "blog",
    "announce",
    "launch",
    "press",
    "comms",
    "growth",
    "channel",
    "audience",
  ],
  operations: [
    "ops",
    "operation",
    "admin",
    "schedule",
    "process",
    "workflow",
    "automation",
    "standup",
    "status",
    "recap",
    "triage",
    "organize",
    "sync",
  ],
  product: [
    "product",
    "roadmap",
    "strategy",
    "feature",
    "prd",
    "spec",
    "planning",
    "adoption",
    "discovery",
    "research",
  ],
  design: [
    "design",
    "ui",
    "ux",
    "visual",
    "creative",
    "brand",
    "mockup",
    "prototype",
    "illustration",
  ],
  hr: [
    "hr",
    "people",
    "team",
    "hire",
    "hiring",
    "recruit",
    "interview",
    "onboard",
    "feedback",
    "culture",
    "1:1",
  ],
  finance: [
    "finance",
    "revenue",
    "billing",
    "invoice",
    "expense",
    "budget",
    "mrr",
    "arr",
    "cash",
    "pricing",
    "payment",
    "pipeline",
  ],
  legal: [
    "legal",
    "contract",
    "policy",
    "compliance",
    "terms",
    "gdpr",
    "privacy",
    "license",
    "regulation",
    "dpa",
  ],
};

const TAG_BONUS: Record<SkillTag, StarAxis[]> = {
  product: ["product"],
  growth: ["marketing"],
  sales: ["marketing", "finance"],
  customer: ["hr", "marketing"],
  reporting: ["operations"],
};

const FOUNDER_KEYWORDS = [
  "delegate",
  "prioritise",
  "prioritize",
  "vision",
  "decision",
  "roadmap",
  "hire",
  "raise",
  "fundraise",
  "investor",
  "board",
  "strategy",
];

const FOUNDER_WEIGHT_FINANCE = 0.6;
const FOUNDER_WEIGHT_KEYWORD = 1;

function makeEmptyAxes(): Record<StarAxis, number> {
  return {
    marketing: 0,
    operations: 0,
    product: 0,
    design: 0,
    hr: 0,
    finance: 0,
    legal: 0,
  };
}

export function computeStarMap(skills: StarMapInput[]): StarMapScores {
  const axes = makeEmptyAxes();
  let founderKeywordHits = 0;

  for (const skill of skills) {
    const haystack = `${skill.title} ${skill.description}`.toLowerCase();

    for (const axis of AXIS_ORDER) {
      const keywords = AXIS_KEYWORDS[axis];
      if (keywords.some((kw) => haystack.includes(kw))) {
        axes[axis] += 1;
      }
    }

    for (const tag of skill.tags) {
      for (const axis of TAG_BONUS[tag] ?? []) {
        axes[axis] += 1;
      }
    }

    if (FOUNDER_KEYWORDS.some((kw) => haystack.includes(kw))) {
      founderKeywordHits += 1;
    }
  }

  const founder =
    axes.finance * FOUNDER_WEIGHT_FINANCE +
    founderKeywordHits * FOUNDER_WEIGHT_KEYWORD;

  let max = 0;
  let total = 0;
  for (const axis of AXIS_ORDER) {
    if (axes[axis] > max) max = axes[axis];
    total += axes[axis];
  }

  return { axes, founder, max, total };
}
