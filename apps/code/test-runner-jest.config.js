const path = require("node:path");
const { getJestConfig } = require("@storybook/test-runner");

const baseConfig = getJestConfig();

module.exports = {
  ...baseConfig,
  forceExit: true,
  // test-runner-globals.js must come first: Storybook 10 loads test-runner.ts
  // outside Jest's module scope, so `jest` has to be reachable via globalThis
  // for setup() to call jest.retryTimes / jest.setTimeout.
  setupFilesAfterEnv: [
    path.resolve(__dirname, "test-runner-globals.js"),
    ...(baseConfig.setupFilesAfterEnv ?? []),
  ],
  // Deletes baseline PNGs that no story wrote this run (renamed/removed
  // stories otherwise leave orphaned snapshots forever). Only takes effect
  // when JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE=1 is set, which CI sets on `-u`
  // runs; local debugging runs are unaffected.
  reporters: [
    ...(baseConfig.reporters ?? ["default"]),
    "jest-image-snapshot/src/outdated-snapshot-reporter.js",
  ],
  testTimeout: 60000,
  testEnvironment: path.resolve(__dirname, "test-runner-jest-environment.mjs"),
};
