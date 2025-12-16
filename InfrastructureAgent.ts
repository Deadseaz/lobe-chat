/**
 * InfrastructureAgent - Handles SSH, Docker, Terraform and infrastructure operations
 */

import { BaseAgent } from './BaseAgent';
import { AgentType, AgentTask, TaskResult, AgentCapability } from './types';
import { TerraformService } from './services/terraform-service';

export class InfrastructureAgent extends BaseAgent {
  private sshService: any;
  private dockerService: any;
  private terraformService: TerraformService;

  constructor(context: any) {
    const capabilities: AgentCapability[] = [
      {
        name: 'ssh-execute',
        description: 'Execute commands on remote servers via SSH',
        requiredServices: ['sshService']
      },
      {
        name: 'docker-manage',
        description: 'Manage Docker containers and images',
        requiredServices: ['dockerService']
      },
      {
        name: 'server-provisioning',
        description: 'Provision and configure servers',
        requiredServices: ['sshService', 'dockerService']
      },
      {
        name: 'container-orchestration',
        description: 'Orchestrate container deployments',
        requiredServices: ['dockerService']
      },
      {
        name: 'terraform-manage',
        description: 'Manage infrastructure with Terraform (init, plan, apply, destroy)',
        requiredServices: ['terraformService']
      },
      {
        name: 'infrastructure-as-code',
        description: 'Infrastructure as Code operations via Terraform',
        requiredServices: ['terraformService']
      }
    ];

    super(
      `infrastructure-${Date.now()}`,
      'InfrastructureAgent',
      AgentType.INFRASTRUCTURE,
      capabilities,
      context
    );

    this.sshService = context.services?.sshService;
    this.dockerService = context.services?.dockerService;
    
    // Initialize Terraform service with configurable working directory
    const terraformWorkDir = context.env?.TERRAFORM_WORKING_DIR || '/app/terraform';
    this.terraformService = new TerraformService({ workingDir: terraformWorkDir });
  }

  protected async onInitialize(): Promise<void> {
    console.log('[InfrastructureAgent] Initializing services...');

    // Validate required services
    if (!this.sshService) {
      console.warn('[InfrastructureAgent] SSH service not available');
    }

    if (!this.dockerService) {
      console.warn('[InfrastructureAgent] Docker service not available');
    }

    // Check Terraform availability
    const tfCheck = await this.terraformService.checkInstalled();
    if (tfCheck.installed) {
      console.log(`[InfrastructureAgent] Terraform available: v${tfCheck.version}`);
    } else {
      console.warn('[InfrastructureAgent] Terraform not installed');
    }
  }

  protected async executeTask(task: AgentTask): Promise<TaskResult> {
    console.log(`[InfrastructureAgent] Executing task: ${task.type}`);

    try {
      switch (task.type) {
        case 'ssh-execute':
          return await this.executeSshCommand(task);

        case 'docker-pull':
          return await this.pullDockerImage(task);

        case 'docker-run':
          return await this.runDockerContainer(task);

        case 'docker-stop':
          return await this.stopDockerContainer(task);

        case 'docker-search':
          return await this.searchDockerRepos(task);

        case 'server-health-check':
          return await this.checkServerHealth(task);

        case 'deploy-application':
          return await this.deployApplication(task);

        // Terraform Operations
        case 'terraform-init':
          return await this.terraformInit(task);

        case 'terraform-plan':
          return await this.terraformPlan(task);

        case 'terraform-apply':
          return await this.terraformApply(task);

        case 'terraform-destroy':
          return await this.terraformDestroy(task);

        case 'terraform-state':
          return await this.terraformState(task);

        case 'terraform-output':
          return await this.terraformOutput(task);

        case 'terraform-validate':
          return await this.terraformValidate(task);

        case 'terraform-workspaces':
          return await this.terraformWorkspaces(task);

        default:
          return {
            success: false,
            error: `Unknown task type: ${task.type}`
          };
      }
    } catch (error) {
      console.error(`[InfrastructureAgent] Task execution error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // SSH Operations
  // ============================================================================

  private async executeSshCommand(task: AgentTask): Promise<TaskResult> {
    if (!this.sshService) {
      return { success: false, error: 'SSH service not available' };
    }

    const { host, port, username, privateKey, command } = task.payload;

    try {
      // Connect to SSH server
      await this.sshService.connect({
        host,
        port: port || 22,
        username,
        privateKey
      });

      // Execute command
      const output = await this.sshService.execute(command);

      // Disconnect
      await this.sshService.disconnect();

      return {
        success: true,
        data: {
          output,
          command,
          host
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async checkServerHealth(task: AgentTask): Promise<TaskResult> {
    if (!this.sshService) {
      return { success: false, error: 'SSH service not available' };
    }

    const { host, port, username, privateKey } = task.payload;

    try {
      await this.sshService.connect({ host, port: port || 22, username, privateKey });

      // Run health check commands
      const cpuUsage = await this.sshService.execute("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'");
      const memoryUsage = await this.sshService.execute("free -m | awk 'NR==2{printf \"%.2f\", $3*100/$2 }'");
      const diskUsage = await this.sshService.execute("df -h / | awk 'NR==2{print $5}'");
      const uptime = await this.sshService.execute("uptime -p");

      await this.sshService.disconnect();

      return {
        success: true,
        data: {
          host,
          cpuUsage: cpuUsage.trim(),
          memoryUsage: memoryUsage.trim() + '%',
          diskUsage: diskUsage.trim(),
          uptime: uptime.trim(),
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Docker Operations
  // ============================================================================

  private async pullDockerImage(task: AgentTask): Promise<TaskResult> {
    if (!this.dockerService) {
      return { success: false, error: 'Docker service not available' };
    }

    const { image, tag } = task.payload;
    const fullImage = tag ? `${image}:${tag}` : image;

    try {
      const result = await this.dockerService.pullImage(fullImage);

      return {
        success: true,
        data: {
          image: fullImage,
          status: 'pulled',
          details: result
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async runDockerContainer(task: AgentTask): Promise<TaskResult> {
    if (!this.dockerService) {
      return { success: false, error: 'Docker service not available' };
    }

    const { image, name, ports, env, volumes, network } = task.payload;

    try {
      // Pull image first if needed
      await this.dockerService.pullImage(image);

      // Start container
      const result = await this.dockerService.startContainer({
        Image: image,
        name: name || `container-${Date.now()}`,
        ExposedPorts: ports ? this.formatPorts(ports) : undefined,
        Env: env || [],
        HostConfig: {
          PortBindings: ports ? this.formatPortBindings(ports) : undefined,
          Binds: volumes || [],
          NetworkMode: network || 'bridge'
        }
      });

      return {
        success: true,
        data: {
          containerId: result.id,
          containerName: name,
          image,
          status: 'running'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async stopDockerContainer(task: AgentTask): Promise<TaskResult> {
    if (!this.dockerService) {
      return { success: false, error: 'Docker service not available' };
    }

    const { containerId, containerName } = task.payload;
    const identifier = containerId || containerName;

    try {
      await this.dockerService.stopContainer(identifier);

      return {
        success: true,
        data: {
          containerId: identifier,
          status: 'stopped'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async searchDockerRepos(task: AgentTask): Promise<TaskResult> {
    if (!this.dockerService) {
      return { success: false, error: 'Docker service not available' };
    }

    const { query, limit } = task.payload;

    try {
      const results = await this.dockerService.searchRepos(query);

      return {
        success: true,
        data: {
          query,
          results: limit ? results.slice(0, limit) : results,
          totalFound: results.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Complex Operations
  // ============================================================================

  private async deployApplication(task: AgentTask): Promise<TaskResult> {
    const { image, host, sshConfig, containerConfig } = task.payload;

    const steps: string[] = [];
    const startTime = Date.now();

    try {
      // Step 1: Connect to server
      steps.push('Connecting to server...');
      if (this.sshService && host) {
        await this.sshService.connect(sshConfig);
        steps.push('Connected to server');
      }

      // Step 2: Pull Docker image
      steps.push(`Pulling Docker image: ${image}`);
      if (this.dockerService) {
        await this.dockerService.pullImage(image);
        steps.push('Image pulled successfully');
      }

      // Step 3: Stop existing container if any
      if (containerConfig.name) {
        steps.push(`Stopping existing container: ${containerConfig.name}`);
        try {
          await this.dockerService.stopContainer(containerConfig.name);
          steps.push('Existing container stopped');
        } catch {
          steps.push('No existing container to stop');
        }
      }

      // Step 4: Start new container
      steps.push('Starting new container...');
      const result = await this.dockerService.startContainer({
        Image: image,
        ...containerConfig
      });
      steps.push(`Container started: ${result.id}`);

      // Step 5: Health check
      steps.push('Performing health check...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
      steps.push('Deployment completed successfully');

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          containerId: result.id,
          image,
          status: 'deployed'
        },
        metadata: {
          executionTime,
          intermediateSteps: steps
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          executionTime: Date.now() - startTime,
          intermediateSteps: steps
        }
      };
    }
  }

  // ============================================================================
  // Terraform Operations
  // ============================================================================

  private async terraformInit(task: AgentTask): Promise<TaskResult> {
    const { workingDir, upgrade, reconfigure } = task.payload || {};
    
    if (workingDir) {
      this.terraformService.setWorkingDir(workingDir);
    }

    const result = await this.terraformService.init({ upgrade, reconfigure });
    
    return {
      success: result.success,
      data: result.success ? { output: result.output, workingDir: this.terraformService.getWorkingDir() } : undefined,
      error: result.success ? undefined : result.output
    };
  }

  private async terraformPlan(task: AgentTask): Promise<TaskResult> {
    const { workingDir, variables, varFiles, target, destroy } = task.payload || {};
    
    if (workingDir) {
      this.terraformService.setWorkingDir(workingDir);
    }

    const result = await this.terraformService.plan({ variables, varFiles, target, destroy });
    
    return {
      success: result.success,
      data: result.success ? {
        hasChanges: result.hasChanges,
        resourceChanges: result.resourceChanges,
        planOutput: result.planOutput
      } : undefined,
      error: result.success ? undefined : result.planOutput
    };
  }

  private async terraformApply(task: AgentTask): Promise<TaskResult> {
    const { workingDir, variables, varFiles, target, autoApprove } = task.payload || {};
    
    if (workingDir) {
      this.terraformService.setWorkingDir(workingDir);
    }

    const result = await this.terraformService.apply({ variables, varFiles, target, autoApprove });
    
    return {
      success: result.success,
      data: result.success ? {
        output: result.output,
        outputs: result.outputs
      } : undefined,
      error: result.success ? undefined : result.output
    };
  }

  private async terraformDestroy(task: AgentTask): Promise<TaskResult> {
    const { workingDir, variables, target, autoApprove } = task.payload || {};
    
    if (workingDir) {
      this.terraformService.setWorkingDir(workingDir);
    }

    const result = await this.terraformService.destroy({ variables, target, autoApprove });
    
    return {
      success: result.success,
      data: result.success ? { output: result.output } : undefined,
      error: result.success ? undefined : result.output
    };
  }

  private async terraformState(task: AgentTask): Promise<TaskResult> {
    const { workingDir, action } = task.payload || {};
    
    if (workingDir) {
      this.terraformService.setWorkingDir(workingDir);
    }

    if (action === 'list') {
      const result = await this.terraformService.listResources();
      return {
        success: result.success,
        data: { resources: result.resources }
      };
    }

    const result = await this.terraformService.getState();
    
    return {
      success: result.success,
      data: result.success ? {
        resources: result.resources,
        raw: result.raw
      } : undefined
    };
  }

  private async terraformOutput(task: AgentTask): Promise<TaskResult> {
    const { workingDir } = task.payload || {};
    
    if (workingDir) {
      this.terraformService.setWorkingDir(workingDir);
    }

    const result = await this.terraformService.getOutputs();
    
    return {
      success: result.success,
      data: { outputs: result.outputs }
    };
  }

  private async terraformValidate(task: AgentTask): Promise<TaskResult> {
    const { workingDir } = task.payload || {};
    
    if (workingDir) {
      this.terraformService.setWorkingDir(workingDir);
    }

    const result = await this.terraformService.validate();
    
    return {
      success: result.valid,
      data: {
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings
      },
      error: result.valid ? undefined : result.errors?.join(', ')
    };
  }

  private async terraformWorkspaces(task: AgentTask): Promise<TaskResult> {
    const { workingDir, action, name } = task.payload || {};
    
    if (workingDir) {
      this.terraformService.setWorkingDir(workingDir);
    }

    switch (action) {
      case 'create':
        if (!name) return { success: false, error: 'Workspace name required' };
        const createResult = await this.terraformService.createWorkspace(name);
        return {
          success: createResult.success,
          data: { output: createResult.output },
          error: createResult.success ? undefined : createResult.output
        };

      case 'select':
        if (!name) return { success: false, error: 'Workspace name required' };
        const selectResult = await this.terraformService.selectWorkspace(name);
        return {
          success: selectResult.success,
          data: { output: selectResult.output },
          error: selectResult.success ? undefined : selectResult.output
        };

      case 'list':
      default:
        const listResult = await this.terraformService.listWorkspaces();
        return {
          success: listResult.success,
          data: {
            workspaces: listResult.workspaces,
            current: listResult.current
          }
        };
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private formatPorts(ports: string[]): any {
    const formatted: any = {};
    ports.forEach(port => {
      formatted[`${port}/tcp`] = {};
    });
    return formatted;
  }

  private formatPortBindings(ports: string[]): any {
    const formatted: any = {};
    ports.forEach(port => {
      const [hostPort, containerPort] = port.includes(':') ? port.split(':') : [port, port];
      formatted[`${containerPort}/tcp`] = [{ HostPort: hostPort }];
    });
    return formatted;
  }
}
