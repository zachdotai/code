// Override keys are exact-case matches on the pre-transform string.
// Use overrides for phrases where word substitutions would read awkwardly.
export const PIRATE_OVERRIDES: Record<string, string> = {
  "Spawn wild hog": "Loose a wild boar",
  "Send wild hog": "Set sail with a wild boar",
  "Send out a wild hog": "Set sail with a wild boar",
  "Short-lived hoglets · no nest, no goal": "Lone boars · no harbor, no quest",
  "Builds nests": "Builds harbors",
  "No messages yet — talk to the hedgehog below.":
    "No missives yet — parley with the hog below.",
  "Message the hedgehog…": "Send a missive to the hog…",
  "No unnested signals. Signal reports from Inbox will appear here for grouping.":
    "No driftin' signals. Reports from the crow's nest will land here for sortin'.",
  'No wild hoglets. Use "Spawn hoglet" to dispatch a short-lived agent for a task, question, or PR, or drop an adopted hoglet here to release it.':
    'No wild boars. Use "Loose a wild boar" for a task, question, or PR, or drop an adopted hog here to set \'em free.',
  Builder: "Shipwright",
  Hedgehouse: "Tavern",
  "Holding area": "Cargo hold",
  "Wild hoglets": "Wild boars",
  "Unnested signals": "Driftin' signals",
  "Nest chat": "Harbor parley",
  "Create a nest": "Lay a new harbor",
  "Create nest": "Lay harbor",
  "Build nest": "Build harbor",
  "Quick nest": "Quick harbor",
  Nest: "Harbor",
};

export const PIRATE_WORD_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\byour\b/gi, "yer"],
  [/\byou\b/gi, "ye"],
  [/\bhello\b/gi, "ahoy"],
  [/\bhi\b/gi, "ahoy"],
  [/\byes\b/gi, "aye"],
  [/\bfriend\b/gi, "matey"],
  [/\bfriends\b/gi, "mateys"],
  [/\bnest\b/gi, "harbor"],
  [/\bnests\b/gi, "harbors"],
  [/\bbuilder\b/gi, "shipwright"],
  [/\bsend\b/gi, "set sail with"],
  [/\bmessage\b/gi, "missive"],
  [/\bmessages\b/gi, "missives"],
  [/\bcancel\b/gi, "belay"],
  [/\bsave\b/gi, "stow"],
  [/\barchive\b/gi, "send to davy jones"],
  [/\bcontinue\b/gi, "press on"],
  [/\brepository\b/gi, "ship's log"],
  [/\bprompt\b/gi, "marching orders"],
  [/\bhog\b/gi, "boar"],
  [/\bhogs\b/gi, "boars"],
];
