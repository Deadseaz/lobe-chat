/**
 * Jenkins CI/CD Integration Service
 * Real Jenkins pipeline automation - ZERO MOCKS
 */

import { ConfigService } from '../shared/config.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// INTERFACES
// ============================================================================

export interface JenkinsConfig {
  url: string;
  username?: string;
  apiToken?: string;
}

export interface JenkinsPipeline {
  name: string;
  script: string; // Jenkinsfile content
  parameters?: JenkinsParameter[];
  triggers?: JenkinsTrigger[];
}

export interface JenkinsParameter {
  name: string;
  type: 'string' | 'boolean' | 'choice' | 'password';
  defaultValue?: any;
  description?: string;
  choices?: string[]; // For choice type
}

export interface JenkinsTrigger {
  type: 'cron' | 'scm' | 'webhook';
  spec: string;
}

export interface JenkinsBuild {
  number: number;
  url: string;
  building: boolean;
  result?: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED';
  duration: number;
  timestamp: number;
}

export interface JenkinsJob {
  name: string;
  url: string;
  buildable: boolean;
  lastBuild?: JenkinsBuild;
  lastSuccessfulBuild?: JenkinsBuild;
  lastFailedBuild?: JenkinsBuild;
}

// ============================================================================
// JENKINS SERVICE
// ============================================================================

export class JenkinsService {
  private config: JenkinsConfig;
  private baseUrl: string;
  private authHeader: string;

  constructor(config: JenkinsConfig) {
    this.config = config;
    this.baseUrl = config.url.replace(/\/+$/, ''); // Remove trailing slashes

    // Create Basic Auth header
    if (config.username && config.apiToken) {
      const auth = Buffer.from(`${config.username}:${config.apiToken}`).toString('base64');
      this.authHeader = `Basic ${auth}`;
    } else {
      this.authHeader = '';
    }
  }

  /**
   * Get Jenkins crumb for CSRF protection
   */
  private async getCrumb(): Promise<{ crumb: string; crumbRequestField: string } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/crumbIssuer/api/json`, {
        headers: this.authHeader ? {
          'Authorization': this.authHeader
        } : {}
      });

      if (!response.ok) return null;

      const data = await response.json();
      return {
        crumb: data.crumb,
        crumbRequestField: data.crumbRequestField
      };
    } catch {
      return null;
    }
  }

  /**
   * Create Jenkins job
   */
  async createJob(pipeline: JenkinsPipeline): Promise<{ success: boolean }> {
    const crumb = await this.getCrumb();

    // Generate job XML configuration
    const jobXml = this.generateJobXml(pipeline);

    const headers: Record<string, string> = {
      'Content-Type': 'application/xml'
    };

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    if (crumb) {
      headers[crumb.crumbRequestField] = crumb.crumb;
    }

    const response = await fetch(`${this.baseUrl}/createItem?name=${encodeURIComponent(pipeline.name)}`, {
      method: 'POST',
      headers,
      body: jobXml
    });

    if (!response.ok) {
      throw new Error(`Failed to create Jenkins job: ${await response.text()}`);
    }

    return { success: true };
  }

  /**
   * Generate Jenkins job XML configuration
   */
  private generateJobXml(pipeline: JenkinsPipeline): string {
    const parametersXml = pipeline.parameters?.map(param => {
      switch (param.type) {
        case 'string':
          return `
            <hudson.model.StringParameterDefinition>
              <name>${param.name}</name>
              <description>${param.description || ''}</description>
              <defaultValue>${param.defaultValue || ''}</defaultValue>
            </hudson.model.StringParameterDefinition>
          `;
        case 'boolean':
          return `
            <hudson.model.BooleanParameterDefinition>
              <name>${param.name}</name>
              <description>${param.description || ''}</description>
              <defaultValue>${param.defaultValue || false}</defaultValue>
            </hudson.model.BooleanParameterDefinition>
          `;
        case 'choice':
          return `
            <hudson.model.ChoiceParameterDefinition>
              <name>${param.name}</name>
              <description>${param.description || ''}</description>
              <choices>${param.choices?.map(c => `<string>${c}</string>`).join('')}</choices>
            </hudson.model.ChoiceParameterDefinition>
          `;
        default:
          return '';
      }
    }).join('') || '';

    const triggersXml = pipeline.triggers?.map(trigger => {
      if (trigger.type === 'cron') {
        return `<hudson.triggers.TimerTrigger><spec>${trigger.spec}</spec></hudson.triggers.TimerTrigger>`;
      } else if (trigger.type === 'scm') {
        return `<hudson.triggers.SCMTrigger><spec>${trigger.spec}</spec></hudson.triggers.SCMTrigger>`;
      }
      return '';
    }).join('') || '';

    return `<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>ZAgent Pipeline - ${pipeline.name}</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    ${parametersXml ? `
    <hudson.model.ParametersDefinitionProperty>
      <parameterDefinitions>
        ${parametersXml}
      </parameterDefinitions>
    </hudson.model.ParametersDefinitionProperty>
    ` : ''}
    <org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
      <triggers>
        ${triggersXml}
      </triggers>
    </org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps">
    <script>${this.escapeXml(pipeline.script)}</script>
    <sandbox>true</sandbox>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>`;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Trigger Jenkins build
   */
  async triggerBuild(jobName: string, parameters?: Record<string, any>): Promise<{ queueId: number }> {
    const crumb = await this.getCrumb();

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    if (crumb) {
      headers[crumb.crumbRequestField] = crumb.crumb;
    }

    let url = `${this.baseUrl}/job/${encodeURIComponent(jobName)}`;

    if (parameters && Object.keys(parameters).length > 0) {
      url += '/buildWithParameters';
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(parameters)) {
        params.append(key, String(value));
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: params
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger build: ${await response.text()}`);
      }

      // Get queue ID from Location header
      const location = response.headers.get('Location') || '';
      const queueId = parseInt(location.split('/').pop() || '0');

      return { queueId };
    } else {
      url += '/build';

      const response = await fetch(url, {
        method: 'POST',
        headers
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger build: ${await response.text()}`);
      }

      const location = response.headers.get('Location') || '';
      const queueId = parseInt(location.split('/').pop() || '0');

      return { queueId };
    }
  }

  /**
   * Get job info
   */
  async getJob(jobName: string): Promise<JenkinsJob> {
    const headers: Record<string, string> = {};

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    const response = await fetch(`${this.baseUrl}/job/${encodeURIComponent(jobName)}/api/json`, {
      headers
    });

    if (!response.ok) {
      throw new Error(`Failed to get job info: ${await response.text()}`);
    }

    const data = await response.json();

    return {
      name: data.name,
      url: data.url,
      buildable: data.buildable,
      lastBuild: data.lastBuild ? {
        number: data.lastBuild.number,
        url: data.lastBuild.url,
        building: data.lastBuild.building || false,
        result: data.lastBuild.result,
        duration: data.lastBuild.duration || 0,
        timestamp: data.lastBuild.timestamp || 0
      } : undefined,
      lastSuccessfulBuild: data.lastSuccessfulBuild,
      lastFailedBuild: data.lastFailedBuild
    };
  }

  /**
   * Get build info
   */
  async getBuild(jobName: string, buildNumber: number): Promise<JenkinsBuild> {
    const headers: Record<string, string> = {};

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    const response = await fetch(
      `${this.baseUrl}/job/${encodeURIComponent(jobName)}/${buildNumber}/api/json`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to get build info: ${await response.text()}`);
    }

    const data = await response.json();

    return {
      number: data.number,
      url: data.url,
      building: data.building,
      result: data.result,
      duration: data.duration,
      timestamp: data.timestamp
    };
  }

  /**
   * Get build console output
   */
  async getBuildConsole(jobName: string, buildNumber: number): Promise<string> {
    const headers: Record<string, string> = {};

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    const response = await fetch(
      `${this.baseUrl}/job/${encodeURIComponent(jobName)}/${buildNumber}/consoleText`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to get console output: ${await response.text()}`);
    }

    return await response.text();
  }

  /**
   * Wait for build completion
   */
  async waitForBuild(jobName: string, buildNumber: number, timeout: number = 300000): Promise<JenkinsBuild> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const build = await this.getBuild(jobName, buildNumber);

      if (!build.building) {
        return build;
      }

      // Wait 5 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error(`Build timeout after ${timeout}ms`);
  }

  /**
   * Stop build
   */
  async stopBuild(jobName: string, buildNumber: number): Promise<void> {
    const crumb = await this.getCrumb();

    const headers: Record<string, string> = {};

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    if (crumb) {
      headers[crumb.crumbRequestField] = crumb.crumb;
    }

    const response = await fetch(
      `${this.baseUrl}/job/${encodeURIComponent(jobName)}/${buildNumber}/stop`,
      {
        method: 'POST',
        headers
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to stop build: ${await response.text()}`);
    }
  }

  /**
   * Delete job
   */
  async deleteJob(jobName: string): Promise<void> {
    const crumb = await this.getCrumb();

    const headers: Record<string, string> = {};

    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }

    if (crumb) {
      headers[crumb.crumbRequestField] = crumb.crumb;
    }

    const response = await fetch(
      `${this.baseUrl}/job/${encodeURIComponent(jobName)}/doDelete`,
      {
        method: 'POST',
        headers
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete job: ${await response.text()}`);
    }
  }

  /**
   * Create ZAgent deployment pipeline
   */
  async createZAgentPipeline(environment: string = 'production'): Promise<{ success: boolean }> {
    const pipeline: JenkinsPipeline = {
      name: `zagent-deploy-${environment}`,
      parameters: [
        {
          name: 'ENVIRONMENT',
          type: 'choice',
          choices: ['development', 'staging', 'production'],
          defaultValue: environment,
          description: 'Deployment environment'
        },
        {
          name: 'RUN_TESTS',
          type: 'boolean',
          defaultValue: true,
          description: 'Run tests before deployment'
        },
        {
          name: 'ROLLBACK_ON_FAILURE',
          type: 'boolean',
          defaultValue: true,
          description: 'Automatically rollback on deployment failure'
        }
      ],
      triggers: [
        {
          type: 'scm',
          spec: 'H/5 * * * *' // Poll SCM every 5 minutes
        }
      ],
      script: `
pipeline {
  agent any

  environment {
    CF_ACCOUNT_ID = credentials('cloudflare-account-id')
    CF_API_TOKEN = credentials('cloudflare-api-token')
    DEPLOYMENT_ENV = params.ENVIRONMENT
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        echo "Checked out code for ${DEPLOYMENT_ENV} deployment"
      }
    }

    stage('Install Dependencies') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Build') {
      steps {
        sh 'npm run build'
        echo 'Build completed successfully'
      }
    }

    stage('Test') {
      when {
        expression { params.RUN_TESTS == true }
      }
      steps {
        sh 'npm run test:run'
        junit 'test-results/**/*.xml'
      }
    }

    stage('Deploy to Cloudflare') {
      steps {
        script {
          def deployResult = sh(
            script: "wrangler deploy --env ${DEPLOYMENT_ENV}",
            returnStatus: true
          )

          if (deployResult != 0) {
            error("Deployment failed")
          }

          echo "Successfully deployed to ${DEPLOYMENT_ENV}"
        }
      }
    }

    stage('Health Check') {
      steps {
        script {
          sleep(time: 30, unit: 'SECONDS')

          def healthUrl = "${env.WORKER_URL}/health"
          def healthCheck = sh(
            script: "curl -f ${healthUrl}",
            returnStatus: true
          )

          if (healthCheck != 0) {
            error("Health check failed")
          }

          echo 'Health check passed'
        }
      }
    }

    stage('Integration Tests') {
      when {
        expression { params.RUN_TESTS == true }
      }
      steps {
        sh 'npm run test:integration'
      }
    }
  }

  post {
    failure {
      script {
        if (params.ROLLBACK_ON_FAILURE == true) {
          echo 'Deployment failed, rolling back...'
          sh 'wrangler rollback'
        }
      }

      emailext (
        subject: "ZAgent Deployment FAILED: ${DEPLOYMENT_ENV}",
        body: "Deployment to ${DEPLOYMENT_ENV} failed. Check console output for details.",
        to: '${DEFAULT_RECIPIENTS}'
      )
    }

    success {
      emailext (
        subject: "ZAgent Deployment SUCCESS: ${DEPLOYMENT_ENV}",
        body: "Successfully deployed to ${DEPLOYMENT_ENV}",
        to: '${DEFAULT_RECIPIENTS}'
      )
    }

    always {
      cleanWs()
    }
  }
}
`
    };

    return await this.createJob(pipeline);
  }
}

/**
 * Initialize Jenkins integration
 */
export async function initializeJenkins(
  jenkinsUrl: string,
  username?: string,
  apiToken?: string
): Promise<JenkinsService> {
  const config: JenkinsConfig = {
    url: jenkinsUrl,
    username,
    apiToken
  };

  const jenkins = new JenkinsService(config);

  // Create default ZAgent pipelines
  try {
    await jenkins.createZAgentPipeline('development');
    await jenkins.createZAgentPipeline('staging');
    await jenkins.createZAgentPipeline('production');
    console.log('✅ Jenkins pipelines created');
  } catch (error) {
    console.warn('Could not create Jenkins pipelines:', error);
  }

  return jenkins;
}
