export interface ITray {
  isSupported(): boolean;
  show(): void;
  hide(): void;
  setBadgeCount(count: number): void;
  setTooltip(text: string): void;
  onClick(handler: () => void): void;
}
