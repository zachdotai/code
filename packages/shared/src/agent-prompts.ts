export function buildAdditionalDirectoriesPrompt(
  directories: readonly string[] | undefined,
): string {
  if (!directories?.length) return "";
  const escapeXml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dirs = directories
    .map((directory) => `  <directory>${escapeXml(directory)}</directory>`)
    .join("\n");
  return `The user has granted you access to additional directories outside the working directory. You may read and edit files in these paths just like the working directory:\n<additional_directories>\n${dirs}\n</additional_directories>`;
}
