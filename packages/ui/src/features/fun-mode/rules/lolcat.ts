// Override keys are exact-case matches on the pre-transform string.
// Use overrides for phrases where word substitutions read awkwardly.
export const LOLCAT_OVERRIDES: Record<string, string> = {
  "Spawn wild hog": "i can has wild hog",
  "Send wild hog": "send teh wild hog plz",
  "Send out a wild hog": "i can has send wild hog?",
  "Build nest": "buildz teh nest",
  "Quick nest": "kwik nest",
  "Create a nest": "i can has nest?",
  "Create nest": "buildz nest",
  "Short-lived hoglets · no nest, no goal":
    "shorty hogletz · no nest, no kwest",
  "Builds nests": "buildz nestz",
  "No messages yet — talk to the hedgehog below.":
    "no mesages yet — talk to teh hedgehog belo.",
  "Message the hedgehog…": "tell teh hedgehog…",
  "No unnested signals. Signal reports from Inbox will appear here for grouping.":
    "no homeless signals. signal reportz from inbox iz comin here 4 groupin.",
  'No wild hoglets. Use "Spawn hoglet" to dispatch a short-lived agent for a task, question, or PR, or drop an adopted hoglet here to release it.':
    'no wild hoglets. uze "spawn hoglet" 4 a task, kwestion, or PR, or drop adopted hoglet here 2 setz him free.',
  Builder: "buildz0r",
  Hedgehouse: "haus of cheez",
  "Holding area": "kitteh corner",
  "Wild hoglets": "feral hogletz",
  "Unnested signals": "homeless signalz",
  "Nest chat": "nest meowmeow",
  Nest: "nest",
  Save: "keepz",
  Relocate: "movez",
  Archive: "buryz",
  Send: "sendz",
  Cancel: "nope",
  Continue: "moar",
  Prompt: "tellz it",
  Repository: "reepo",
  "Start spec draft": "begin teh draft",
};

export const LOLCAT_WORD_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bthe\b/gi, "teh"],
  [/\bhave\b/gi, "has"],
  [/\bhas\b/gi, "haz"],
  [/\bwith\b/gi, "wif"],
  [/\bmy\b/gi, "mai"],
  [/\bplease\b/gi, "plz"],
  [/\bthanks\b/gi, "thx"],
  [/\bthank you\b/gi, "thx"],
  [/\bcheeseburger\b/gi, "cheezburger"],
  [/\bcheese\b/gi, "cheez"],
  [/\bmessage\b/gi, "mesage"],
  [/\bcancel\b/gi, "nope"],
  [/\bbuild\b/gi, "buildz"],
  [/\bnow\b/gi, "rite nao"],
  [/\bagent\b/gi, "kitteh"],
  [/\bagents\b/gi, "kittehs"],
];

// Sentence-level transforms applied after word rules.
export const LOLCAT_SENTENCE_RULES: ReadonlyArray<(s: string) => string> = [
  (s) => s.toLowerCase(),
];
