/**
 * Deployment Automation and CI/CD Service for zagent
 * Provides comprehensive deployment automation, CI/CD pipelines, and infrastructure management
 */

import { Context } from 'hono';
import { AIGuardrailsService } from '../shared/middleware.js';
import { ConfigService } from '../shared/config.js';

export interface DeploymentConfig {
  id: string;
  name: string;
  description: string;
  source: {
    type: 'git' | 'docker' | 'registry' | 'artifact';
    url: string;
    branch?: string;
    tag?: string;
    path?: string;
  };
  build: {
    enabled: boolean;
    dockerfile?: string;
    buildArgs?: Record<string, string>;
    context?: string;
  };
  deployment: {
    targets: Array<{
      environment: string;
      provider: 'cloudflare' | 'aws' | 'azure' | 'gcp' | 'docker' | 'kubernetes';
      config: any; // Provider-specific configuration
    }>;
    strategy: 'rolling' | 'blue-green' | 'canary' | 'recreate';
    healthCheck?: {
      type: 'http' | 'tcp' | 'command';
      path?: string;
      port?: number;
      command?: string;
      timeout: number;
      retries: number;
    };
  };
  testing: {
    enabled: boolean;
    preDeploy?: string[];
    postDeploy?: string[];
    integrationTests?: boolean;
  };
  monitoring: {
    enabled: boolean;
    alerts: boolean;
    metrics: boolean;
  };
  security: {
    scan: boolean;
    policyCheck: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  active: boolean;
}

export interface DeploymentPipeline {
  id: string;
  name: string;
  config: DeploymentConfig;
  triggers: Array<{
    type: 'webhook' | 'schedule' | 'manual' | 'git' | 'tag';
    conditions?: any;
    webhookUrl?: string;
  }>;
  stages: Array<{
    name: 'build' | 'test' | 'staging' | 'production';
    enabled: boolean;
    config: any;
  }>;
  status: 'idle' | 'running' | 'paused' | 'failed' | 'completed';
  lastRun?: Date;
  nextRun?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeploymentJob {
  id: string;
  pipelineId: string;
  stage: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  logs: string[];
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  error?: string;
}

export interface DeploymentResult {
  id: string;
  jobId: string;
  environment: string;
  version: string;
  status: 'success' | 'failed' | 'partial';
  deployedAt: Date;
  duration: number; // in seconds
  resources: Array<{
    type: 'worker' | 'function' | 'container' | 'service';
    id: string;
    name: string;
    status: 'created' | 'updated' | 'deleted' | 'skipped';
  }>;
  logs: string[];
  rollbackPossible: boolean;
}

export interface RollbackPlan {
  id: string;
  deploymentId: string;
  targetVersion: string;
  previousVersion: string;
  resources: Array<{
    type: string;
    id: string;
    rollbackScript: string;
  }>;
  executed: boolean;
  executedAt?: Date;
  error?: string;
}

export interface CICDConfig {
  autoDeploy: boolean;
  autoRollback: boolean;
  maxDeployments: number;
  deploymentTimeout: number; // in seconds
  rollbackThreshold: number; // failure percentage
  securityScan: boolean;
  policyCheck: boolean;
  notificationOn: {
    success: boolean;
    failure: boolean;
    rollback: boolean;
  };
}

export class DeploymentAutomationService {
  private pipelines: Map<string, DeploymentPipeline> = new Map();
  private jobs: Map<string, DeploymentJob> = new Map();
  private results: Map<string, DeploymentResult> = new Map();
  private configs: Map<string, DeploymentConfig> = new Map();
  private rollbacks: Map<string, RollbackPlan> = new Map();
  private aiGuardrails: AIGuardrailsService;
  private configService: ConfigService;
  private ciCdConfig: CICDConfig;
  private activeJobs: Set<string> = new Set();

  constructor(aiGuardrails: AIGuardrailsService, configService: ConfigService) {
    this.aiGuardrails = aiGuardrails;
    this.configService = configService;
    
    const config = this.configService.getConfig();
    this.ciCdConfig = {
      autoDeploy: config.originalEnv?.CI_CD_AUTO_DEPLOY === 'true' ?? true,
      autoRollback: config.originalEnv?.CI_CD_AUTO_ROLLBACK === 'true' ?? true,
      maxDeployments: parseInt(config.originalEnv?.CI_CD_MAX_DEPLOYMENTS || '5'),
      deploymentTimeout: parseInt(config.originalEnv?.CI_CD_DEPLOYMENT_TIMEOUT || '300'), // 5 minutes
      rollbackThreshold: parseInt(config.originalEnv?.CI_CD_ROLLBACK_THRESHOLD || '5'), // 5% failure
      securityScan: config.originalEnv?.CI_CD_SECURITY_SCAN !== 'false',
      policyCheck: config.originalEnv?.CI_CD_POLICY_CHECK !== 'false',
      notificationOn: {
        success: config.originalEnv?.NOTIFY_ON_SUCCESS !== 'false',
        failure: config.originalEnv?.NOTIFY_ON_FAILURE !== 'false',
        rollback: config.originalEnv?.NOTIFY_ON_ROLLBACK !== 'false'
      }
    };
    
    // Initialize with some default deployment configurations
    this.initializeDefaultConfigs();
    
    // Start monitoring jobs
    this.startJobMonitoring();
  }

  private initializeDefaultConfigs(): void {
    // Add a default deployment configuration for the zagent itself
    const defaultConfig: DeploymentConfig = {
      id: 'zagent-default-deploy',
      name: 'Zagent Default Deployment',
      description: 'Default deployment configuration for Zagent',
      source: {
        type: 'git',
        url: 'https://github.com/zagent/zagent.git',
        branch: 'main'
      },
      build: {
        enabled: true,
        dockerfile: 'Dockerfile',
        context: '.'
      },
      deployment: {
        targets: [
          {
            environment: 'production',
            provider: 'cloudflare',
            config: {
              accountId: this.configService.getConfig().cfAccountId,
              scriptName: 'zagent-production'
            }
          }
        ],
        strategy: 'rolling',
        healthCheck: {
          type: 'http',
          path: '/health',
          port: 3000,
          timeout: 30,
          retries: 3
        }
      },
      testing: {
        enabled: true,
        integrationTests: true
      },
      monitoring: {
        enabled: true,
        alerts: true,
        metrics: true
      },
      security: {
        scan: true,
        policyCheck: true
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system',
      active: true
    };
    
    this.configs.set(defaultConfig.id, defaultConfig);
  }

  private startJobMonitoring(): void {
    // Monitor running jobs and handle timeouts
    setInterval(() => {
      this.monitorRunningJobs();
    }, 10000); // Check every 10 seconds
  }

  private monitorRunningJobs(): void {
    const now = new Date();
    
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === 'running' && job.startedAt) {
        const duration = (now.getTime() - job.startedAt.getTime()) / 1000; // in seconds
        
        // Check if job has exceeded timeout
        if (duration > this.ciCdConfig.deploymentTimeout) {
          job.status = 'failed';
          job.error = `Job timed out after ${this.ciCdConfig.deploymentTimeout} seconds`;
          job.completedAt = now;
          this.jobs.set(jobId, job);
          
          this.activeJobs.delete(jobId);
          
          // Log timeout
          job.logs.push(`ERROR: Job timed out after ${this.ciCdConfig.deploymentTimeout} seconds`);
        }
      }
    }
  }

  /**
   * Create a new deployment configuration
   */
  async createDeploymentConfig(config: Omit<DeploymentConfig, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>): Promise<{ success: boolean; config?: DeploymentConfig; error?: string }> {
    // Validate config using AI guardrails
    const configValidation = await this.aiGuardrails.validateInput(JSON.stringify(config));
    if (!configValidation.allowed) {
      return { success: false, error: `Configuration validation failed: ${configValidation.reason}` };
    }
    
    // Validate source URL
    if (config.source.url) {
      const urlValidation = await this.aiGuardrails.validateInput(config.source.url);
      if (!urlValidation.allowed) {
        return { success: false, error: `Source URL validation failed: ${urlValidation.reason}` };
      }
    }
    
    const newConfig: DeploymentConfig = {
      ...config,
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'system',
      active: true
    };
    
    this.configs.set(newConfig.id, newConfig);
    
    return { success: true, config: newConfig };
  }

  /**
   * Get a deployment configuration by ID
   */
  getDeploymentConfig(id: string): DeploymentConfig | undefined {
    return this.configs.get(id);
  }

  /**
   * Create a new deployment pipeline
   */
  async createPipeline(pipeline: Omit<DeploymentPipeline, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<{ success: boolean; pipeline?: DeploymentPipeline; error?: string }> {
    // Validate pipeline config
    const pipelineValidation = await this.aiGuardrails.validateInput(JSON.stringify(pipeline));
    if (!pipelineValidation.allowed) {
      return { success: false, error: `Pipeline validation failed: ${pipelineValidation.reason}` };
    }
    
    const newPipeline: DeploymentPipeline = {
      ...pipeline,
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'idle'
    };
    
    this.pipelines.set(newPipeline.id, newPipeline);
    
    return { success: true, pipeline: newPipeline };
  }

  /**
   * Trigger a deployment by pipeline ID
   */
  async triggerDeployment(pipelineId: string, environment?: string, version?: string, dryRun: boolean = false): Promise<{ success: boolean; jobId?: string; error?: string }> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      return { success: false, error: `Pipeline with ID ${pipelineId} not found` };
    }

    const config = this.configs.get(pipeline.config.id);
    if (!config || !config.active) {
      return { success: false, error: `Deployment configuration is not active` };
    }

    // Create a new job for this deployment
    const jobId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const job: DeploymentJob = {
      id: jobId,
      pipelineId,
      stage: 'pending',
      status: 'pending',
      logs: [`Job ${jobId} created at ${new Date().toISOString()}`],
      startedAt: new Date()
    };

    this.jobs.set(jobId, job);
    
    if (dryRun) {
      job.logs.push('DRY RUN: Deployment steps would execute here');
      job.status = 'success';
      job.completedAt = new Date();
      this.jobs.set(jobId, job);
      return { success: true, jobId };
    }

    // Start the actual deployment process
    this.activeJobs.add(jobId);
    this.executeDeploymentJob(jobId, config, environment, version)
      .catch(error => {
        console.error(`Error executing deployment job ${jobId}:`, error);
        const job = this.jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : 'Unknown error';
          job.completedAt = new Date();
          job.logs.push(`ERROR: ${job.error}`);
          this.jobs.set(jobId, job);
          this.activeJobs.delete(jobId);
        }
      });

    return { success: true, jobId };
  }

  /**
   * Execute a deployment job through its stages
   */
  private async executeDeploymentJob(jobId: string, config: DeploymentConfig, environment?: string, version?: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    
    try {
      job.stage = 'build';
      job.status = 'running';
      job.logs.push(`Starting deployment for ${config.name}`);
      this.jobs.set(jobId, job);

      // 1. Security scanning stage
      if (config.security.scan) {
        job.logs.push('Starting security scan...');
        const scanResult = await this.performSecurityScan(config.source);
        if (!scanResult.success) {
          throw new Error(`Security scan failed: ${scanResult.error}`);
        }
        job.logs.push('Security scan completed successfully');
      }

      // 2. Policy checking stage
      if (config.security.policyCheck) {
        job.logs.push('Starting policy check...');
        const policyCheckResult = await this.performPolicyCheck(config);
        if (!policyCheckResult.success) {
          throw new Error(`Policy check failed: ${policyCheckResult.error}`);
        }
        job.logs.push('Policy check completed successfully');
      }

      // 3. Build stage
      job.stage = 'build';
      if (config.build.enabled) {
        job.logs.push('Starting build process...');
        const buildResult = await this.executeBuild(config.build, config.source);
        if (!buildResult.success) {
          throw new Error(`Build failed: ${buildResult.error}`);
        }
        job.logs.push('Build completed successfully');
      }

      // 4. Testing stage
      job.stage = 'test';
      if (config.testing.enabled) {
        job.logs.push('Starting tests...');
        const testResult = await this.executeTests(config.testing, config.source);
        if (!testResult.success) {
          throw new Error(`Testing failed: ${testResult.error}`);
        }
        job.logs.push('Tests completed successfully');
      }

      // 5. Deployment stage
      job.stage = 'deploy';
      job.logs.push('Starting deployment...');
      
      let targetEnvironments = config.deployment.targets;
      if (environment) {
        targetEnvironments = targetEnvironments.filter(t => t.environment === environment);
      }
      
      const deploymentResults: DeploymentResult[] = [];
      for (const target of targetEnvironments) {
        const deployResult = await this.executeDeployment(target, config, version);
        if (!deployResult.success) {
          // If auto-rollback is enabled and deployment failed
          if (this.ciCdConfig.autoRollback) {
            job.logs.push(`Deployment failed to ${target.environment}, initiating rollback...`);
            await this.executeRollback(config, target.environment);
          }
          throw new Error(`Deployment failed to ${target.environment}: ${deployResult.error}`);
        }
        
        deploymentResults.push(deployResult.result!);
        job.logs.push(`Deployment successful to ${target.environment}`);
      }

      // 6. Health check stage
      job.stage = 'health-check';
      for (const target of targetEnvironments) {
        if (config.deployment.healthCheck) {
          job.logs.push(`Running health check for ${target.environment}...`);
          const healthResult = await this.performHealthCheck(target, config.deployment.healthCheck);
          if (!healthResult.success) {
            job.logs.push(`Health check failed for ${target.environment}: ${healthResult.error}`);
            if (this.ciCdConfig.autoRollback) {
              job.logs.push(`Health check failed, initiating rollback for ${target.environment}...`);
              await this.executeRollback(config, target.environment);
            }
          } else {
            job.logs.push(`Health check passed for ${target.environment}`);
          }
        }
      }

      // Mark job as successful
      job.status = 'success';
      job.completedAt = new Date();
      this.jobs.set(jobId, job);
      this.activeJobs.delete(jobId);

      // Store deployment results
      for (const result of deploymentResults) {
        this.results.set(result.id, result);
      }

      job.logs.push('Deployment completed successfully');
      
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.logs.push(`Deployment failed: ${job.error}`);
      this.jobs.set(jobId, job);
      this.activeJobs.delete(jobId);
      
      throw error;
    }
  }

  /**
   * Execute the build stage
   */
  private async executeBuild(buildConfig: DeploymentConfig['build'], sourceConfig: DeploymentConfig['source']): Promise<{ success: boolean; error?: string }> {
    // In a real implementation, this would execute the build process
    // For now, we'll simulate the build process
    
    try {
      // Simulate build process
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second build simulation
      
      // Validate build artifacts if needed
      if (buildConfig.dockerfile) {
        // In a real system, we would build the Docker image
        console.log(`Building with Dockerfile: ${buildConfig.dockerfile}`);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Build failed' };
    }
  }

  /**
   * Execute tests
   */
  private async executeTests(testingConfig: DeploymentConfig['testing'], sourceConfig: DeploymentConfig['source']): Promise<{ success: boolean; error?: string }> {
    try {
      // Simulate running tests
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second test simulation
      
      // For now, assume tests pass
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Tests failed' };
    }
  }

  /**
   * Execute actual deployment to target
   */
  private async executeDeployment(target: DeploymentConfig['deployment']['targets'][0], config: DeploymentConfig, version?: string): Promise<{ success: boolean; result?: DeploymentResult; error?: string }> {
    try {
      const deploymentId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const startedAt = new Date();
      
      // Simulate deployment based on provider
      let resources: DeploymentResult['resources'] = [];
      
      switch (target.provider) {
        case 'cloudflare':
          resources = await this.deployToCloudflare(target, config, version);
          break;
        case 'docker':
          resources = await this.deployToDocker(target, config, version);
          break;
        case 'kubernetes':
          resources = await this.deployToKubernetes(target, config, version);
          break;
        default:
          // For other providers, use a generic deployment
          resources = [{
            type: 'service',
            id: `${target.environment}-${Date.now()}`,
            name: `app-${target.environment}`,
            status: 'created'
          }];
      }
      
      const result: DeploymentResult = {
        id: deploymentId,
        jobId: 'temporary', // Will be set when we know the job ID
        environment: target.environment,
        version: version || 'latest',
        status: 'success',
        deployedAt: new Date(),
        duration: (Date.now() - startedAt.getTime()) / 1000, // duration in seconds
        resources,
        logs: [`Deployed to ${target.environment} using ${target.provider}`],
        rollbackPossible: true
      };
      
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Deployment failed' };
    }
  }

  /**
   * Deploy to Cloudflare
   */
  private async deployToCloudflare(target: DeploymentConfig['deployment']['targets'][0], config: DeploymentConfig, version?: string): Promise<DeploymentResult['resources']> {
    // In a real implementation, this would call Cloudflare APIs
    // For now, we'll simulate the deployment
    
    // Get Cloudflare API credentials from config
    const cfConfig = this.configService.getConfig();
    
    // Deploy the worker
    console.log(`Deploying to Cloudflare account: ${cfConfig.cfAccountId}`);
    
    return [{
      type: 'worker',
      id: `worker-${Date.now()}`,
      name: target.config.scriptName || 'zagent-worker',
      status: 'updated'
    }];
  }

  /**
   * Deploy to Docker
   */
  private async deployToDocker(target: DeploymentConfig['deployment']['targets'][0], config: DeploymentConfig, version?: string): Promise<DeploymentResult['resources']> {
    // In a real implementation, this would interact with Docker
    // For now, we'll simulate the deployment
    
    return [{
      type: 'container',
      id: `container-${Date.now()}`,
      name: target.config.containerName || 'zagent-container',
      status: 'created'
    }];
  }

  /**
   * Deploy to Kubernetes
   */
  private async deployToKubernetes(target: DeploymentConfig['deployment']['targets'][0], config: DeploymentConfig, version?: string): Promise<DeploymentResult['resources']> {
    // In a real implementation, this would interact with Kubernetes
    // For now, we'll simulate the deployment
    
    return [{
      type: 'service',
      id: `service-${Date.now()}`,
      name: target.config.serviceName || 'zagent-service',
      status: 'created'
    }];
  }

  /**
   * Perform security scan
   */
  private async performSecurityScan(source: DeploymentConfig['source']): Promise<{ success: boolean; error?: string }> {
    // Simulate security scanning
    // In a real implementation, this would call security scanning tools
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second scan simulation
    
    // For now, assume scan passes
    return { success: true };
  }

  /**
   * Perform policy check
   */
  private async performPolicyCheck(config: DeploymentConfig): Promise<{ success: boolean; error?: string }> {
    // Simulate policy checking
    // In a real implementation, this would check against organizational policies
    await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second check simulation
    
    // For now, assume policy check passes
    return { success: true };
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(target: DeploymentConfig['deployment']['targets'][0], healthCheck: DeploymentConfig['deployment']['healthCheck']): Promise<{ success: boolean; error?: string }> {
    // Simulate health checking
    // In a real implementation, this would make actual health check requests
    await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second check simulation
    
    // For now, assume health check passes
    return { success: true };
  }

  /**
   * Execute rollback for a failed deployment
   */
  private async executeRollback(config: DeploymentConfig, environment: string): Promise<{ success: boolean; error?: string }> {
    try {
      // In a real implementation, this would execute rollback procedures
      // For now, we'll simulate the rollback
      
      // Create a rollback plan
      const rollbackId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const rollbackPlan: RollbackPlan = {
        id: rollbackId,
        deploymentId: `deploy-${Date.now()}`,
        targetVersion: 'previous',
        previousVersion: 'current',
        resources: [], // Would contain actual rollback scripts
        executed: true,
        executedAt: new Date()
      };
      
      this.rollbacks.set(rollbackId, rollbackPlan);
      
      console.log(`Rollback executed for environment: ${environment}`);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Rollback failed' };
    }
  }

  /**
   * Get deployment job by ID
   */
  getDeploymentJob(jobId: string): DeploymentJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get deployment jobs for a pipeline
   */
  getDeploymentJobsForPipeline(pipelineId: string): DeploymentJob[] {
    return Array.from(this.jobs.values()).filter(job => job.pipelineId === pipelineId);
  }

  /**
   * Get deployment results for a job
   */
  getDeploymentResults(jobId: string): DeploymentResult[] {
    return Array.from(this.results.values()).filter(result => result.jobId === jobId);
  }

  /**
   * Get all deployment configurations
   */
  getDeploymentConfigs(): DeploymentConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Get all deployment pipelines
   */
  getDeploymentPipelines(): DeploymentPipeline[] {
    return Array.from(this.pipelines.values());
  }

  /**
   * Get deployment results with optional filtering
   */
  getDeploymentResultsList(filters?: {
    environment?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
  }): DeploymentResult[] {
    let results = Array.from(this.results.values());

    if (filters?.environment) {
      results = results.filter(r => r.environment === filters.environment);
    }

    if (filters?.status) {
      results = results.filter(r => r.status === filters.status);
    }

    if (filters?.startDate) {
      results = results.filter(r => r.deployedAt >= filters.startDate!);
    }

    if (filters?.endDate) {
      results = results.filter(r => r.deployedAt <= filters.endDate!);
    }

    // Sort by deployedAt, descending (newest first)
    results.sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime());

    return results;
  }

  /**
   * Get deployment metrics and statistics
   */
  getDeploymentMetrics(): any {
    const allResults = Array.from(this.results.values());
    
    const totalDeployments = allResults.length;
    const successfulDeployments = allResults.filter(r => r.status === 'success').length;
    const failedDeployments = allResults.filter(r => r.status === 'failed').length;
    
    const avgDuration = totalDeployments > 0 
      ? allResults.reduce((sum, r) => sum + r.duration, 0) / totalDeployments 
      : 0;
    
    // Calculate success rate
    const successRate = totalDeployments > 0 ? (successfulDeployments / totalDeployments) * 100 : 0;
    
    // Get deployments by environment
    const deploymentsByEnvironment: Record<string, number> = {};
    for (const result of allResults) {
      deploymentsByEnvironment[result.environment] = (deploymentsByEnvironment[result.environment] || 0) + 1;
    }
    
    return {
      totalDeployments,
      successfulDeployments,
      failedDeployments,
      successRate,
      avgDuration,
      deploymentsByEnvironment,
      activeJobs: this.activeJobs.size,
      lastDeployment: allResults.length > 0 
        ? new Date(Math.max(...allResults.map(r => r.deployedAt.getTime()))) 
        : null
    };
  }

  /**
   * Pause a deployment pipeline
   */
  pausePipeline(pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      return false;
    }
    
    pipeline.status = 'paused';
    pipeline.updatedAt = new Date();
    this.pipelines.set(pipelineId, pipeline);
    
    return true;
  }

  /**
   * Resume a deployment pipeline
   */
  resumePipeline(pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      return false;
    }
    
    pipeline.status = 'idle';
    pipeline.updatedAt = new Date();
    this.pipelines.set(pipelineId, pipeline);
    
    return true;
  }

  /**
   * Cancel a running deployment job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }
    
    job.status = 'cancelled';
    job.completedAt = new Date();
    job.logs.push(`Job was cancelled by user at ${job.completedAt.toISOString()}`);
    this.jobs.set(jobId, job);
    
    this.activeJobs.delete(jobId);
    
    return true;
  }

  /**
   * Get deployment logs
   */
  getDeploymentLogs(jobId: string): string[] {
    const job = this.jobs.get(jobId);
    if (!job) {
      return [];
    }
    
    return [...job.logs];
  }

  /**
   * Update CI/CD configuration
   */
  updateCICDConfig(newConfig: Partial<CICDConfig>): CICDConfig {
    this.ciCdConfig = {
      ...this.ciCdConfig,
      ...newConfig
    };
    
    return this.ciCdConfig;
  }

  /**
   * Get CI/CD configuration
   */
  getCICDConfig(): CICDConfig {
    return { ...this.ciCdConfig };
  }

  /**
   * Cleanup old deployment results to manage storage
   */
  cleanupOldDeployments(maxAgeDays: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    let deletedCount = 0;
    
    for (const [id, result] of this.results.entries()) {
      if (result.deployedAt < cutoffDate) {
        this.results.delete(id);
        deletedCount++;
      }
    }
    
    return deletedCount;
  }
}

// Initialize Deployment Automation middleware
export const initializeDeploymentAutomation = async (c: Context, next: () => Promise<void>) => {
  const aiGuardrailsService = c.get('aiGuardrailsService');
  const configService = c.get('configService');
  
  if (!aiGuardrailsService || !configService) {
    console.error('AI Guardrails or Config service not initialized for deployment automation');
    throw new Error('Required services not available for deployment automation');
  }
  
  const deploymentAutomationService = new DeploymentAutomationService(aiGuardrailsService, configService);
  c.set('deploymentAutomationService', deploymentAutomationService);
  
  await next();
};