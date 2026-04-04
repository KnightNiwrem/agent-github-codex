import { readFile } from "node:fs/promises";

export async function readPackageVersion(
  packageJsonFile = new URL("../package.json", import.meta.url),
): Promise<string> {
  const packageJsonContents = await readFile(packageJsonFile, "utf8");

  let packageJson: {
    version?: unknown;
  };

  try {
    packageJson = JSON.parse(packageJsonContents) as {
      version?: unknown;
    };
  } catch (error) {
    throw new Error("Invalid package.json: must contain valid JSON.", {
      cause: error,
    });
  }

  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error("package.json must contain a non-empty version string.");
  }

  return packageJson.version;
}
