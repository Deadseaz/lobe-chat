/**
 * Terraform Service - Infrastructure as Code Management
 * Enables LobeChat to manage infrastructure via Terraform
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface TerraformConfig {
  workingDir: string;
  terraformPath?: string;
  autoApprove?: boolean;
  varFiles?: string[];
  variables?: Record<string, string>;
}

export interface TerraformPlanResult {
  success: boolean;
  hasChanges: boolean;
  planOutput: string;
  resourceChanges?: {
    create: number;
    update: number;
    delete: number;
  };
}

export interface TerraformApplyResult {
  success: boolean;
  output: string;
  state?: any;
  outputs?: Record<string, any>;
}

export interface TerraformStateResource {
  type: string;
  name: string;
  provider: string;
  instances: any[];
}

/**
 * Terraform Service for Infrastructure Management
 */
export class TerraformService {
  private workingDir: string;
  private terraformPath: string;
  private autoApprove: boolean;

  constructor(config?: Partial<TerraformConfig>) {
    this.workingDir = config?.workingDir || process.env.TERRAFORM_WORKING_DIR || '/app/terraform';
    this.terraformPath = config?.terraformPath || process.env.TERRAFORM_PATH || 'terraform';
    this.autoApprove = config?.autoApprove ?? false;
  }

  /**
   * Check if Terraform is installed and accessible
   */
  async checkInstalled(): Promise<{ installed: boolean; version?: string }> {
    try {
      const { stdout } = await execAsync(`${this.terraformPath} version -json`);
      const versionInfo = JSON.parse(stdout);
      return {
        installed: true,
        version: versionInfo.terraform_version
      };
    } catch (error) {
      // Try without -json flag for older versions
      try {
        const { stdout } = await execAsync(`${this.terraformPath} version`);
        const match = stdout.match(/Terraform v([\d.]+)/);
        return {
          installed: true,
          version: match ? match[1] : 'unknown'
        };
      } catch {
        return { installed: false };
      }
    }
  }

  /**
   * Initialize Terraform in the working directory
   */
  async init(options?: { upgrade?: boolean; reconfigure?: boolean }): Promise<{ success: boolean; output: string }> {
    const args = ['init'];
    
    if (options?.upgrade) args.push('-upgrade');
    if (options?.reconfigure) args.push('-reconfigure');
    
    args.push('-no-color');

    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} ${args.join(' ')}`,
        { cwd: this.workingDir }
      );
      
      return {
        success: true,
        output: stdout + (stderr ? `\n${stderr}` : '')
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || String(error)
      };
    }
  }

  /**
   * Validate Terraform configuration
   */
  async validate(): Promise<{ valid: boolean; errors?: string[]; warnings?: string[] }> {
    try {
      const { stdout } = await execAsync(
        `${this.terraformPath} validate -json`,
        { cwd: this.workingDir }
      );
      
      const result = JSON.parse(stdout);
      return {
        valid: result.valid,
        errors: result.diagnostics?.filter((d: any) => d.severity === 'error').map((d: any) => d.summary),
        warnings: result.diagnostics?.filter((d: any) => d.severity === 'warning').map((d: any) => d.summary)
      };
    } catch (error: any) {
      return {
        valid: false,
        errors: [error.message || String(error)]
      };
    }
  }

  /**
   * Generate Terraform plan
   */
  async plan(options?: { 
    variables?: Record<string, string>;
    varFiles?: string[];
    target?: string;
    destroy?: boolean;
  }): Promise<TerraformPlanResult> {
    const args = ['plan', '-no-color', '-detailed-exitcode'];
    
    // Add variables
    if (options?.variables) {
      for (const [key, value] of Object.entries(options.variables)) {
        args.push(`-var=${key}=${value}`);
      }
    }
    
    // Add var files
    if (options?.varFiles) {
      for (const file of options.varFiles) {
        args.push(`-var-file=${file}`);
      }
    }
    
    // Target specific resource
    if (options?.target) {
      args.push(`-target=${options.target}`);
    }
    
    // Destroy plan
    if (options?.destroy) {
      args.push('-destroy');
    }

    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} ${args.join(' ')}`,
        { cwd: this.workingDir }
      );
      
      const output = stdout + (stderr ? `\n${stderr}` : '');
      const hasChanges = !output.includes('No changes');
      
      // Parse resource changes
      const createMatch = output.match(/(\d+) to add/);
      const updateMatch = output.match(/(\d+) to change/);
      const deleteMatch = output.match(/(\d+) to destroy/);
      
      return {
        success: true,
        hasChanges,
        planOutput: output,
        resourceChanges: {
          create: createMatch ? parseInt(createMatch[1]) : 0,
          update: updateMatch ? parseInt(updateMatch[1]) : 0,
          delete: deleteMatch ? parseInt(deleteMatch[1]) : 0
        }
      };
    } catch (error: any) {
      // Exit code 2 means changes present (detailed-exitcode)
      if (error.code === 2) {
        return {
          success: true,
          hasChanges: true,
          planOutput: error.stdout || '',
          resourceChanges: { create: 0, update: 0, delete: 0 }
        };
      }
      
      return {
        success: false,
        hasChanges: false,
        planOutput: error.message || String(error)
      };
    }
  }

  /**
   * Apply Terraform configuration
   */
  async apply(options?: {
    variables?: Record<string, string>;
    varFiles?: string[];
    target?: string;
    autoApprove?: boolean;
  }): Promise<TerraformApplyResult> {
    const args = ['apply', '-no-color'];
    
    // Auto approve if enabled
    if (options?.autoApprove || this.autoApprove) {
      args.push('-auto-approve');
    }
    
    // Add variables
    if (options?.variables) {
      for (const [key, value] of Object.entries(options.variables)) {
        args.push(`-var=${key}=${value}`);
      }
    }
    
    // Add var files
    if (options?.varFiles) {
      for (const file of options.varFiles) {
        args.push(`-var-file=${file}`);
      }
    }
    
    // Target specific resource
    if (options?.target) {
      args.push(`-target=${options.target}`);
    }

    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} ${args.join(' ')}`,
        { cwd: this.workingDir, timeout: 600000 } // 10 min timeout
      );
      
      // Get outputs after apply
      let outputs: Record<string, any> = {};
      try {
        const { stdout: outputJson } = await execAsync(
          `${this.terraformPath} output -json`,
          { cwd: this.workingDir }
        );
        outputs = JSON.parse(outputJson);
      } catch {
        // Outputs might not exist
      }
      
      return {
        success: true,
        output: stdout + (stderr ? `\n${stderr}` : ''),
        outputs
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || String(error)
      };
    }
  }

  /**
   * Destroy Terraform-managed infrastructure
   */
  async destroy(options?: {
    variables?: Record<string, string>;
    target?: string;
    autoApprove?: boolean;
  }): Promise<{ success: boolean; output: string }> {
    const args = ['destroy', '-no-color'];
    
    if (options?.autoApprove || this.autoApprove) {
      args.push('-auto-approve');
    }
    
    if (options?.variables) {
      for (const [key, value] of Object.entries(options.variables)) {
        args.push(`-var=${key}=${value}`);
      }
    }
    
    if (options?.target) {
      args.push(`-target=${options.target}`);
    }

    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} ${args.join(' ')}`,
        { cwd: this.workingDir, timeout: 600000 }
      );
      
      return {
        success: true,
        output: stdout + (stderr ? `\n${stderr}` : '')
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || String(error)
      };
    }
  }

  /**
   * Get current Terraform state
   */
  async getState(): Promise<{ success: boolean; resources?: TerraformStateResource[]; raw?: any }> {
    try {
      const { stdout } = await execAsync(
        `${this.terraformPath} show -json`,
        { cwd: this.workingDir }
      );
      
      const state = JSON.parse(stdout);
      const resources: TerraformStateResource[] = [];
      
      if (state.values?.root_module?.resources) {
        for (const resource of state.values.root_module.resources) {
          resources.push({
            type: resource.type,
            name: resource.name,
            provider: resource.provider_name,
            instances: resource.values ? [resource.values] : []
          });
        }
      }
      
      return {
        success: true,
        resources,
        raw: state
      };
    } catch (error: any) {
      return {
        success: false
      };
    }
  }

  /**
   * List all resources in state
   */
  async listResources(): Promise<{ success: boolean; resources?: string[] }> {
    try {
      const { stdout } = await execAsync(
        `${this.terraformPath} state list`,
        { cwd: this.workingDir }
      );
      
      const resources = stdout.trim().split('\n').filter(r => r.length > 0);
      
      return {
        success: true,
        resources
      };
    } catch (error: any) {
      return {
        success: false,
        resources: []
      };
    }
  }

  /**
   * Get Terraform outputs
   */
  async getOutputs(): Promise<{ success: boolean; outputs?: Record<string, any> }> {
    try {
      const { stdout } = await execAsync(
        `${this.terraformPath} output -json`,
        { cwd: this.workingDir }
      );
      
      return {
        success: true,
        outputs: JSON.parse(stdout)
      };
    } catch (error: any) {
      return {
        success: false,
        outputs: {}
      };
    }
  }

  /**
   * Import existing resource into Terraform state
   */
  async import(resourceAddress: string, resourceId: string): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} import -no-color ${resourceAddress} ${resourceId}`,
        { cwd: this.workingDir }
      );
      
      return {
        success: true,
        output: stdout + (stderr ? `\n${stderr}` : '')
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || String(error)
      };
    }
  }

  /**
   * Refresh Terraform state
   */
  async refresh(): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} refresh -no-color`,
        { cwd: this.workingDir }
      );
      
      return {
        success: true,
        output: stdout + (stderr ? `\n${stderr}` : '')
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || String(error)
      };
    }
  }

  /**
   * Format Terraform files
   */
  async format(options?: { check?: boolean; recursive?: boolean }): Promise<{ success: boolean; output: string; filesChanged?: string[] }> {
    const args = ['fmt', '-no-color'];
    
    if (options?.check) args.push('-check');
    if (options?.recursive) args.push('-recursive');
    
    args.push('-diff');

    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} ${args.join(' ')}`,
        { cwd: this.workingDir }
      );
      
      const output = stdout + (stderr ? `\n${stderr}` : '');
      const filesChanged = output.split('\n').filter(l => l.trim().length > 0);
      
      return {
        success: true,
        output,
        filesChanged
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || String(error)
      };
    }
  }

  /**
   * Create a new Terraform workspace
   */
  async createWorkspace(name: string): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} workspace new ${name}`,
        { cwd: this.workingDir }
      );
      
      return {
        success: true,
        output: stdout + (stderr ? `\n${stderr}` : '')
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || String(error)
      };
    }
  }

  /**
   * Select Terraform workspace
   */
  async selectWorkspace(name: string): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync(
        `${this.terraformPath} workspace select ${name}`,
        { cwd: this.workingDir }
      );
      
      return {
        success: true,
        output: stdout + (stderr ? `\n${stderr}` : '')
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message || String(error)
      };
    }
  }

  /**
   * List Terraform workspaces
   */
  async listWorkspaces(): Promise<{ success: boolean; workspaces?: string[]; current?: string }> {
    try {
      const { stdout } = await execAsync(
        `${this.terraformPath} workspace list`,
        { cwd: this.workingDir }
      );
      
      const lines = stdout.trim().split('\n');
      const workspaces: string[] = [];
      let current: string | undefined;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('*')) {
          current = trimmed.substring(1).trim();
          workspaces.push(current);
        } else if (trimmed) {
          workspaces.push(trimmed);
        }
      }
      
      return {
        success: true,
        workspaces,
        current
      };
    } catch (error: any) {
      return {
        success: false,
        workspaces: []
      };
    }
  }

  /**
   * Set working directory
   */
  setWorkingDir(dir: string): void {
    this.workingDir = dir;
  }

  /**
   * Get working directory
   */
  getWorkingDir(): string {
    return this.workingDir;
  }
}

// Export singleton instance
export const terraformService = new TerraformService();
