export type MediaAccessStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export interface IMediaAccess {
  getMicrophoneStatus(): MediaAccessStatus;
  requestMicrophoneAccess(): Promise<boolean>;
}
