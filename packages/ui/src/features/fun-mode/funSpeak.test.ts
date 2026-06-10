import { describe, expect, it } from "vitest";
import { funSpeak } from "./funSpeak";

describe("funSpeak", () => {
  it("is identity for mode 'none'", () => {
    expect(funSpeak("Builder", "none")).toBe("Builder");
    expect(funSpeak("anything here", "none")).toBe("anything here");
  });

  it("returns empty string unchanged in any mode", () => {
    expect(funSpeak("", "pirate")).toBe("");
    expect(funSpeak("", "lolcat")).toBe("");
  });

  describe("pirate", () => {
    it("applies exact-match overrides", () => {
      expect(funSpeak("Spawn wild hog", "pirate")).toBe("Loose a wild boar");
      expect(funSpeak("Builder", "pirate")).toBe("Shipwright");
    });

    it("preserves case on word substitutions", () => {
      expect(funSpeak("Your repository", "pirate")).toBe("Yer ship's log");
      expect(funSpeak("YOUR REPOSITORY", "pirate")).toBe("YER SHIP'S LOG");
      expect(funSpeak("your repository", "pirate")).toBe("yer ship's log");
    });

    it("substitutes multiple words within a phrase", () => {
      // "Send" is title-cased so replacement gets first-letter-uppercased.
      expect(funSpeak("Send your message", "pirate")).toBe(
        "Set sail with yer missive",
      );
    });

    it("leaves unmatched words alone", () => {
      expect(funSpeak("Holding area", "pirate")).toBe("Cargo hold");
      const result = funSpeak("Custom freeform text", "pirate");
      expect(result).toContain("freeform");
    });
  });

  describe("lolcat", () => {
    it("applies exact-match overrides", () => {
      expect(funSpeak("Builder", "lolcat")).toBe("buildz0r");
      expect(funSpeak("Hedgehouse", "lolcat")).toBe("haus of cheez");
    });

    it("lowercases output via sentence rule", () => {
      // No override hits, so word rules + lowercase apply.
      const result = funSpeak("I Love Cheeseburger", "lolcat");
      expect(result).toBe(result.toLowerCase());
      expect(result).toContain("cheezburger");
    });

    it("substitutes common words", () => {
      const result = funSpeak("the message has it", "lolcat");
      expect(result).toContain("teh");
      expect(result).toContain("mesage");
      expect(result).toContain("haz");
    });
  });
});
