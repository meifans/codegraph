import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  jsonDeepEqual,
  readJsonFile,
  removeMarkedSection,
  replaceOrAppendMarkedSection,
  writeJsonFile,
} from './shared';
import {
  CODEGRAPH_SECTION_END,
  CODEGRAPH_SECTION_START,
  INSTRUCTIONS_TEMPLATE,
} from '../instructions-template';

/**
 * Returns the path to the antigravity configuration directory.
 * Under ~/.gemini/config
 */
function configDir(): string {
  return path.join(os.homedir(), '.gemini', 'config');
}

/**
 * Returns the path to the antigravity MCP configuration JSON file.
 * Under ~/.gemini/config/mcp_config.json
 */
function mcpConfigPath(): string {
  return path.join(configDir(), 'mcp_config.json');
}

/**
 * Returns the path to the AGENTS.md instruction file for antigravity.
 * Under ~/.gemini/config/AGENTS.md
 */
function instructionsPath(): string {
  return path.join(configDir(), 'AGENTS.md');
}

/**
 * Builds the canonical MCP configuration object for antigravity.
 * Excludes the "type" field and includes "env: {}" as requested.
 */
function buildAntigravityMcpConfig(): { command: string; args: string[]; env: Record<string, any> } {
  return {
    command: 'codegraph',
    args: ['serve', '--mcp'],
    env: {},
  };
}

/**
 * Writes the antigravity MCP entry into ~/.gemini/config/mcp_config.json.
 * Preserves sibling servers and creates directory/file if they do not exist.
 */
function writeMcpEntry(): WriteResult['files'][number] {
  const file = mcpConfigPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const existing = readJsonFile(file);
  const before = existing.mcpServers?.codegraph;
  const after = buildAntigravityMcpConfig();

  if (jsonDeepEqual(before, after)) {
    return { path: file, action: 'unchanged' };
  }

  const action: 'created' | 'updated' = before ? 'updated' : (fs.existsSync(file) ? 'updated' : 'created');
  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.codegraph = after;
  writeJsonFile(file, existing);
  return { path: file, action };
}

/**
 * Writes the markdown agent instructions into ~/.gemini/config/AGENTS.md.
 * Appends or replaces the section with the CodeGraph markers.
 */
function writeInstructionsEntry(): WriteResult['files'][number] {
  const file = instructionsPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const action = replaceOrAppendMarkedSection(
    file,
    INSTRUCTIONS_TEMPLATE,
    CODEGRAPH_SECTION_START,
    CODEGRAPH_SECTION_END,
  );
  const mapped: 'created' | 'updated' | 'unchanged' =
    action === 'created' ? 'created'
      : action === 'unchanged' ? 'unchanged'
        : 'updated';
  return { path: file, action: mapped };
}

class AntigravityTarget implements AgentTarget {
  readonly id = 'antigravity' as const;
  readonly displayName = 'antigravity';
  readonly docsUrl = 'https://antigravity.google/download';

  /**
   * Returns true if the location is supported.
   * antigravity target only supports global installation.
   */
  supportsLocation(loc: Location): boolean {
    return loc === 'global';
  }

  /**
   * Detects whether antigravity target has been installed and configured.
   */
  detect(loc: Location): DetectionResult {
    if (loc !== 'global') {
      return { installed: false, alreadyConfigured: false };
    }
    const mcpPath = mcpConfigPath();
    const config = readJsonFile(mcpPath);
    const alreadyConfigured = !!config.mcpServers?.codegraph;
    const installed = fs.existsSync(path.join(os.homedir(), '.gemini')) || fs.existsSync(mcpPath);
    return { installed, alreadyConfigured, configPath: mcpPath };
  }

  /**
   * Installs codegraph MCP configurations and instructions for antigravity.
   */
  install(loc: Location, _opts: InstallOptions): WriteResult {
    if (loc !== 'global') {
      return {
        files: [],
        notes: ['antigravity has no project-local config — re-run with --location=global to install.'],
      };
    }
    const files: WriteResult['files'] = [];

    files.push(writeMcpEntry());
    files.push(writeInstructionsEntry());

    return {
      files,
      notes: ['Restart antigravity for MCP changes to take effect.'],
    };
  }

  /**
   * Uninstalls codegraph configurations and instructions for antigravity.
   */
  uninstall(loc: Location): WriteResult {
    if (loc !== 'global') return { files: [] };
    const files: WriteResult['files'] = [];

    const mcpPath = mcpConfigPath();
    const config = readJsonFile(mcpPath);
    if (config.mcpServers?.codegraph) {
      delete config.mcpServers.codegraph;
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      writeJsonFile(mcpPath, config);
      files.push({ path: mcpPath, action: 'removed' });
    } else {
      files.push({ path: mcpPath, action: 'not-found' });
    }

    const instr = instructionsPath();
    const action = removeMarkedSection(instr, CODEGRAPH_SECTION_START, CODEGRAPH_SECTION_END);
    files.push({ path: instr, action });

    return { files };
  }

  /**
   * Prints the configuration snippet for manual pasting.
   */
  printConfig(loc: Location): string {
    if (loc !== 'global') {
      return '# antigravity has no project-local config — use --location=global.\n';
    }
    const target = mcpConfigPath();
    const snippet = JSON.stringify(
      {
        mcpServers: {
          codegraph: buildAntigravityMcpConfig(),
        },
      },
      null,
      2
    );
    return `# Add to ${target}\n\n${snippet}\n`;
  }

  /**
   * Returns list of paths created/modified by this target.
   */
  describePaths(loc: Location): string[] {
    if (loc !== 'global') return [];
    return [mcpConfigPath(), instructionsPath()];
  }
}

export const antigravityTarget: AgentTarget = new AntigravityTarget();
