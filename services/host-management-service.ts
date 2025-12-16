/**
 * Host Management Service
 * Advanced host management including provisioning, configuration, monitoring, and lifecycle management
 */

import { Context } from 'hono';
import { SSHService } from './ssh-service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface HostConfig {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authentication: {
    type: 'password' | 'privateKey';
    value: string;
  };
  os: 'linux' | 'windows' | 'macos';
  tags?: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  lastConnected?: Date;
}

export interface HostMetrics {
  hostId: string;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkIn: number;
  networkOut: number;
  loadAverage: [number, number, number]; // 1min, 5min, 15min
  uptime: number; // seconds
  timestamp: Date;
}

export interface HostProvisioningConfig {
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean' | 'custom';
  region?: string;
  instanceType?: string;
  imageId?: string;
  securityGroups?: string[];
  keyPair?: string;
  userData?: string; // cloud-init script for Linux
  rootVolumeSize?: number; // in GB
  tags?: Record<string, string>;
}

export interface HostConfiguration {
  packages: string[]; // packages to install
  services: Array<{ name: string; action: 'start' | 'stop' | 'restart' | 'enable' | 'disable' }>;
  files: Array<{
    path: string;
    content: string;
    permissions?: string; // e.g. '0644', '0755'
    owner?: string;
    group?: string;
  }>;
  environment: Record<string, string>;
  users: Array<{
    name: string;
    password?: string;
    publicKey?: string;
    groups?: string[];
    sudo?: boolean;
  }>;
}

export interface HostSecurityScan {
  id: string;
  hostId: string;
  timestamp: Date;
  vulnerabilities: Array<{
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    remediation: string;
  }>;
  score: number; // 0-100 security score
}

export class HostManagementService {
  private hosts: Map<string, HostConfig> = new Map();
  private sshService: SSHService;
  private metrics: Map<string, HostMetrics[]> = new Map();
  private provisioningConfigs: Map<string, HostProvisioningConfig> = new Map();
  private hostConfigurations: Map<string, HostConfiguration> = new Map();
  private securityScans: Map<string, HostSecurityScan[]> = new Map();

  constructor(sshService: SSHService) {
    this.sshService = sshService;
    this.startMetricsCollection();
  }

  /**
   * Register a new host
   */
  async registerHost(config: Omit<HostConfig, 'id' | 'createdAt' | 'lastConnected'>): Promise<HostConfig> {
    const hostId = crypto.randomUUID?.() || `host-${Date.now()}`;
    const host: HostConfig = {
      ...config,
      id: hostId,
      createdAt: new Date(),
      lastConnected: new Date()
    };

    this.hosts.set(hostId, host);
    return host;
  }

  /**
   * Connect to a host and verify access
   */
  async connectToHost(hostId: string): Promise<{ success: boolean; error?: string }> {
    const host = this.hosts.get(hostId);
    if (!host) {
      return { success: false, error: `Host ${hostId} not found` };
    }

    try {
      // Configure SSH connection
      const sshConfig: any = {
        host: host.hostname,
        port: host.port,
        username: host.username
      };

      if (host.authentication.type === 'privateKey') {
        sshConfig.privateKey = host.authentication.value;
      } else {
        sshConfig.password = host.authentication.value;
      }

      // Try to connect via SSH service
      await this.sshService.connect(sshConfig);

      // Execute a simple command to verify connection
      const result = await this.sshService.execute('echo "connection successful"');
      
      if (result.includes('connection successful')) {
        host.lastConnected = new Date();
        this.hosts.set(hostId, host);
        return { success: true };
      } else {
        return { success: false, error: 'Connection test failed' };
      }
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to connect to host: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Execute command on remote host
   */
  async executeCommand(hostId: string, command: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const result = await this.connectToHost(hostId);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    try {
      const output = await this.sshService.execute(command);
      return { success: true, output };
    } catch (error) {
      return { 
        success: false, 
        error: `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get basic host information
   */
  async getHostInfo(hostId: string): Promise<any> {
    const result = await this.connectToHost(hostId);
    if (!result.success) {
      throw new Error(result.error);
    }

    try {
      // Get system information
      const osInfo = await this.sshService.execute('uname -a');
      const uptime = await this.sshService.execute('uptime');
      const diskUsage = await this.sshService.execute('df -h');
      const memoryInfo = await this.sshService.execute('free -h');
      const networkInfo = await this.sshService.execute('ip addr show');

      return {
        osInfo: osInfo.trim(),
        uptime: uptime.trim(),
        diskUsage: diskUsage.trim(),
        memoryInfo: memoryInfo.trim(),
        networkInfo: networkInfo.trim()
      };
    } catch (error) {
      throw new Error(`Failed to get host info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Install packages on host
   */
  async installPackages(hostId: string, packages: string[]): Promise<{ success: boolean; output?: string; error?: string }> {
    const host = this.hosts.get(hostId);
    if (!host) {
      return { success: false, error: `Host ${hostId} not found` };
    }

    const result = await this.connectToHost(hostId);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    try {
      let installCommand = '';
      
      // Determine package manager based on OS
      switch (host.os) {
        case 'linux':
          // Check if it's Ubuntu/Debian or CentOS/RHEL
          const osRelease = await this.sshService.execute('cat /etc/os-release');
          if (osRelease.includes('ubuntu') || osRelease.includes('debian')) {
            installCommand = `apt-get update && apt-get install -y ${packages.join(' ')}`;
          } else {
            installCommand = `yum update -y && yum install -y ${packages.join(' ')}`;
          }
          break;
          
        case 'macos':
          installCommand = `brew install ${packages.join(' ')}`;
          break;
          
        default:
          return { success: false, error: `Package installation not supported for ${host.os}` };
      }

      const output = await this.sshService.execute(installCommand);
      return { success: true, output };
    } catch (error) {
      return { 
        success: false, 
        error: `Package installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Manage services on host
   */
  async manageServices(hostId: string, services: Array<{ name: string; action: 'start' | 'stop' | 'restart' | 'enable' | 'disable' }>): Promise<{ success: boolean; output?: string; error?: string }> {
    const host = this.hosts.get(hostId);
    if (!host) {
      return { success: false, error: `Host ${hostId} not found` };
    }

    const result = await this.connectToHost(hostId);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    try {
      const outputs: string[] = [];

      for (const service of services) {
        let command = '';
        
        switch (host.os) {
          case 'linux':
            switch (service.action) {
              case 'start':
                command = `systemctl start ${service.name}`;
                break;
              case 'stop':
                command = `systemctl stop ${service.name}`;
                break;
              case 'restart':
                command = `systemctl restart ${service.name}`;
                break;
              case 'enable':
                command = `systemctl enable ${service.name}`;
                break;
              case 'disable':
                command = `systemctl disable ${service.name}`;
                break;
            }
            break;

          case 'macos':
            switch (service.action) {
              case 'start':
                command = `brew services start ${service.name}`;
                break;
              case 'stop':
                command = `brew services stop ${service.name}`;
                break;
              case 'restart':
                command = `brew services restart ${service.name}`;
                break;
              default:
                return { success: false, error: `Action ${service.action} not supported for macOS service management` };
            }
            break;

          default:
            return { success: false, error: `Service management not supported for ${host.os}` };
        }

        if (command) {
          const output = await this.sshService.execute(command);
          outputs.push(`Service ${service.name} ${service.action}: ${output}`);
        }
      }

      return { success: true, output: outputs.join('\n') };
    } catch (error) {
      return { 
        success: false, 
        error: `Service management failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Upload file to host
   */
  async uploadFile(hostId: string, localPath: string, remotePath: string): Promise<{ success: boolean; error?: string }> {
    const host = this.hosts.get(hostId);
    if (!host) {
      return { success: false, error: `Host ${hostId} not found` };
    }

    // For this implementation, we'll just execute an scp command via the shell
    // In a real implementation, you'd use a proper SFTP/SCP library
    try {
      // SSH connection details
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null'
      ];

      if (host.authentication.type === 'privateKey') {
        sshArgs.push('-i', host.authentication.value);
      }

      const sshCmd = `scp ${sshArgs.join(' ')} -P ${host.port} "${localPath}" "${host.username}@${host.hostname}:${remotePath}"`;
      await execAsync(sshCmd);

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `File upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Download file from host
   */
  async downloadFile(hostId: string, remotePath: string, localPath: string): Promise<{ success: boolean; error?: string }> {
    const host = this.hosts.get(hostId);
    if (!host) {
      return { success: false, error: `Host ${hostId} not found` };
    }

    try {
      // SSH connection details
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null'
      ];

      if (host.authentication.type === 'privateKey') {
        sshArgs.push('-i', host.authentication.value);
      }

      const sshCmd = `scp ${sshArgs.join(' ')} -P ${host.port} "${host.username}@${host.hostname}:${remotePath}" "${localPath}"`;
      await execAsync(sshCmd);

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `File download failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Create provisioning configuration
   */
  async createProvisioningConfig(config: Omit<HostProvisioningConfig, 'id'>): Promise<HostProvisioningConfig> {
    const configId = crypto.randomUUID?.() || `prov-${Date.now()}`;
    const provisioningConfig: HostProvisioningConfig = {
      ...config,
      id: configId
    };

    this.provisioningConfigs.set(configId, provisioningConfig);
    return provisioningConfig;
  }

  /**
   * Provision a new host
   */
  async provisionHost(provisioningConfigId: string, hostName: string): Promise<{ success: boolean; hostId?: string; error?: string }> {
    const config = this.provisioningConfigs.get(provisioningConfigId);
    if (!config) {
      return { success: false, error: `Provisioning config ${provisioningConfigId} not found` };
    }

    try {
      // This would call cloud provider APIs to provision a new host
      // For this implementation, we'll simulate the provisioning process
      // In a real implementation, you would use AWS SDK, Azure SDK, etc.
      
      // Example AWS provisioning command (simulated)
      let provisionCmd = '';
      switch (config.provider) {
        case 'aws':
          provisionCmd = `aws ec2 run-instances --image-id ${config.imageId || 'ami-0abcdef1234567890'} --count 1 --instance-type ${config.instanceType || 't2.micro'} --key-name ${config.keyPair || ''} --security-group-ids ${config.securityGroups?.join(' ') || ''}`;
          break;
        case 'gcp':
          provisionCmd = `gcloud compute instances create ${hostName} --zone ${config.region || 'us-central1-a'} --machine-type ${config.instanceType || 'e2-micro'} --image-family ${config.imageId || 'debian-11'} --image-project debian-cloud`;
          break;
        // Add cases for other providers as needed
        default:
          return { success: false, error: `Provisioning provider ${config.provider} not supported in this implementation` };
      }

      // In a real implementation, we would execute the actual provisioning command
      // For simulation purposes, we'll create a new host config
      console.log(`Provisioning command would be: ${provisionCmd}`);

      // After provisioning, register the host
      const newHost: Omit<HostConfig, 'id' | 'createdAt' | 'lastConnected'> = {
        name: hostName,
        hostname: `auto-generated-${Date.now()}.example.com`, // This would come from the provider
        port: 22,
        username: 'ubuntu', // Default for most cloud images
        authentication: {
          type: 'privateKey',
          value: config.keyPair || 'default-key-path'
        },
        os: 'linux',
        tags: ['provisioned', config.provider],
        metadata: {
          provider: config.provider,
          region: config.region,
          instanceType: config.instanceType
        }
      };

      const registeredHost = await this.registerHost(newHost);
      return { success: true, hostId: registeredHost.id };
    } catch (error) {
      return { 
        success: false, 
        error: `Host provisioning failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Apply configuration to host
   */
  async applyConfiguration(hostId: string, configuration: HostConfiguration): Promise<{ success: boolean; output?: string; error?: string }> {
    const host = this.hosts.get(hostId);
    if (!host) {
      return { success: false, error: `Host ${hostId} not found` };
    }

    const result = await this.connectToHost(hostId);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    try {
      const outputs: string[] = [];

      // Install packages
      if (configuration.packages.length > 0) {
        const pkgResult = await this.installPackages(hostId, configuration.packages);
        if (!pkgResult.success) {
          return pkgResult; // Fail early if package installation fails
        }
        outputs.push(pkgResult.output || '');
      }

      // Create files
      for (const file of configuration.files) {
        // Create directory if it doesn't exist
        const dir = path.dirname(file.path);
        await this.sshService.execute(`mkdir -p "${dir}"`);

        // Write file content
        const escapedContent = file.content.replace(/"/g, '\\"').replace(/\$/g, '\\$');
        await this.sshService.execute(`echo "${escapedContent}" > "${file.path}"`);

        // Set permissions if specified
        if (file.permissions) {
          await this.sshService.execute(`chmod ${file.permissions} "${file.path}"`);
        }

        // Set owner if specified
        if (file.owner) {
          const group = file.group ? `:${file.group}` : '';
          await this.sshService.execute(`chown ${file.owner}${group} "${file.path}"`);
        }

        outputs.push(`Created file: ${file.path}`);
      }

      // Set environment variables
      for (const [key, value] of Object.entries(configuration.environment)) {
        // Add to profile
        const escapedValue = value.replace(/"/g, '\\"');
        await this.sshService.execute(`echo 'export ${key}="${escapedValue}"' >> ~/.bashrc`);
        outputs.push(`Set environment variable: ${key}`);
      }

      // Manage services
      if (configuration.services.length > 0) {
        const svcResult = await this.manageServices(hostId, configuration.services);
        if (!svcResult.success) {
          return svcResult;
        }
        outputs.push(svcResult.output || '');
      }

      // Create users
      for (const user of configuration.users) {
        // Create user
        await this.sshService.execute(`useradd -m ${user.name}`);
        outputs.push(`Created user: ${user.name}`);

        // Set password if provided
        if (user.password) {
          await this.sshService.execute(`echo '${user.name}:${user.password}' | chpasswd`);
        }

        // Add to groups
        if (user.groups) {
          await this.sshService.execute(`usermod -a -G ${user.groups.join(',')} ${user.name}`);
        }

        // Set up SSH keys
        if (user.publicKey) {
          await this.sshService.execute(`mkdir -p /home/${user.name}/.ssh`);
          await this.sshService.execute(`echo "${user.publicKey}" >> /home/${user.name}/.ssh/authorized_keys`);
          await this.sshService.execute(`chown -R ${user.name}:${user.name} /home/${user.name}/.ssh`);
          await this.sshService.execute('chmod 700 /home/' + user.name + '/.ssh');
          await this.sshService.execute('chmod 600 /home/' + user.name + '/.ssh/authorized_keys');
        }

        // Add to sudo if needed
        if (user.sudo) {
          await this.sshService.execute(`usermod -a -G sudo ${user.name}`);
        }
      }

      // Update the stored configuration
      this.hostConfigurations.set(hostId, configuration);

      return { success: true, output: outputs.join('\n') };
    } catch (error) {
      return { 
        success: false, 
        error: `Configuration application failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Perform security scan on host
   */
  async securityScan(hostId: string): Promise<HostSecurityScan> {
    const host = this.hosts.get(hostId);
    if (!host) {
      throw new Error(`Host ${hostId} not found`);
    }

    const result = await this.connectToHost(hostId);
    if (!result.success) {
      throw new Error(result.error);
    }

    try {
      // Run security scan commands
      // This would typically run a security scanner like Lynis, OpenSCAP, etc.
      
      // Simulate security scan results
      const vulnerabilities = [
        {
          id: 'CVE-2023-1234',
          severity: 'medium',
          title: 'Outdated Package',
          description: 'An outdated package was found with known vulnerabilities',
          remediation: 'Update the package to the latest version'
        },
        {
          id: 'CVE-2023-5678',
          severity: 'high',
          title: 'Misconfigured Service',
          description: 'A service is running with excessive permissions',
          remediation: 'Adjust service permissions to follow principle of least privilege'
        }
      ];

      // Calculate security score (0-100, where 100 is most secure)
      const criticalCount = vulnerabilities.filter(v => v.severity === 'critical').length;
      const highCount = vulnerabilities.filter(v => v.severity === 'high').length;
      const mediumCount = vulnerabilities.filter(v => v.severity === 'medium').length;
      const lowCount = vulnerabilities.filter(v => v.severity === 'low').length;
      
      const score = Math.max(0, 100 - (criticalCount * 25) - (highCount * 15) - (mediumCount * 5) - (lowCount * 1));
      
      const scan: HostSecurityScan = {
        id: crypto.randomUUID?.() || `scan-${Date.now()}`,
        hostId,
        timestamp: new Date(),
        vulnerabilities,
        score
      };

      // Store scan results
      if (!this.securityScans.has(hostId)) {
        this.securityScans.set(hostId, []);
      }
      
      const scans = this.securityScans.get(hostId)!;
      scans.push(scan);
      
      // Keep only last 10 scans to prevent memory issues
      if (scans.length > 10) {
        scans.shift();
      }

      return scan;
    } catch (error) {
      throw new Error(`Security scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get host security history
   */
  getSecurityHistory(hostId: string): HostSecurityScan[] {
    return this.securityScans.get(hostId) || [];
  }

  /**
   * Get host by ID
   */
  getHost(hostId: string): HostConfig | undefined {
    return this.hosts.get(hostId);
  }

  /**
   * Get all hosts
   */
  getAllHosts(): HostConfig[] {
    return Array.from(this.hosts.values());
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    // Collect metrics every 60 seconds
    setInterval(async () => {
      await this.collectMetrics();
    }, 60000);
  }

  /**
   * Collect metrics from all registered hosts
   */
  private async collectMetrics(): Promise<void> {
    for (const [hostId, host] of this.hosts) {
      try {
        const result = await this.connectToHost(hostId);
        if (!result.success) {
          console.warn(`Failed to connect to host ${host.name} for metrics collection: ${result.error}`);
          continue;
        }

        // Get CPU usage
        const cpuResult = await this.sshService.execute("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | sed 's/%us,//'");
        const cpuUsage = parseFloat(cpuResult.trim()) || 0;

        // Get memory usage
        const memResult = await this.sshService.execute("free | grep Mem | awk '{printf \"%.2f\", $3/$2 * 100.0}'");
        const memoryUsage = parseFloat(memResult.trim()) || 0;

        // Get disk usage
        const diskResult = await this.sshService.execute("df / | tail -1 | awk '{print $5}' | sed 's/%//'"); 
        const diskUsage = parseFloat(diskResult.trim()) || 0;

        // Get load average
        const loadResult = await this.sshService.execute("uptime | awk -F'load average:' '{print $2}' | sed 's/,//g'");
        const loadValues = loadResult.trim().split(' ').map(val => parseFloat(val.trim())).filter(val => !isNaN(val));
        const loadAverage: [number, number, number] = [
          loadValues[0] || 0,
          loadValues[1] || 0,
          loadValues[2] || 0
        ];

        // Get uptime
        const uptimeResult = await this.sshService.execute("cat /proc/uptime | awk '{print $1}'");
        const uptime = parseInt(uptimeResult.trim()) || 0;

        // Get network stats (bytes in/out)
        const netResult = await this.sshService.execute("cat /proc/net/dev | grep -v 'lo\\|face' | awk '{print $2, $10}' | head -1");
        const [bytesIn, bytesOut] = netResult.trim().split(' ').map(num => parseInt(num) || 0);

        // Create metrics object
        const metrics: HostMetrics = {
          hostId,
          cpuUsage,
          memoryUsage,
          diskUsage,
          networkIn: bytesIn,
          networkOut: bytesOut,
          loadAverage,
          uptime,
          timestamp: new Date()
        };

        // Store metrics
        if (!this.metrics.has(hostId)) {
          this.metrics.set(hostId, []);
        }

        const hostMetrics = this.metrics.get(hostId)!;
        hostMetrics.push(metrics);

        // Keep only last 1000 metrics to prevent memory issues
        if (hostMetrics.length > 1000) {
          hostMetrics.shift();
        }
      } catch (error) {
        console.error(`Failed to collect metrics for host ${hostId}:`, error);
      }
    }
  }

  /**
   * Get metrics for a host
   */
  getHostMetrics(hostId: string, limit: number = 100): HostMetrics[] {
    const allMetrics = this.metrics.get(hostId) || [];
    return allMetrics.slice(-limit);
  }

  /**
   * Get metrics for all hosts
   */
  getAllHostMetrics(): { [hostId: string]: HostMetrics[] } {
    const result: { [hostId: string]: HostMetrics[] } = {};
    
    for (const [hostId, metrics] of this.metrics) {
      result[hostId] = metrics.slice(-50); // Last 50 metrics per host
    }
    
    return result;
  }

  /**
   * Terminate/destroy a host
   */
  async terminateHost(hostId: string): Promise<{ success: boolean; error?: string }> {
    const host = this.hosts.get(hostId);
    if (!host) {
      return { success: false, error: `Host ${hostId} not found` };
    }

    try {
      // If the host was provisioned through a cloud provider, we would call the appropriate API
      // to terminate the instance. For this implementation, we'll just remove it from our registry.
      
      // Disconnect from the host if connected
      // In a real implementation, you might want to perform graceful shutdown here
      
      // Remove host from our system
      this.hosts.delete(hostId);
      this.metrics.delete(hostId);
      this.securityScans.delete(hostId);
      this.hostConfigurations.delete(hostId);

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Host termination failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get host management statistics
   */
  getHostStats(): {
    totalHosts: number;
    osDistribution: Record<string, number>;
    provisioningConfigs: number;
    activeMetrics: number;
  } {
    const hosts = Array.from(this.hosts.values());
    
    const osDistribution = hosts.reduce((acc, host) => {
      acc[host.os] = (acc[host.os] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalHosts: hosts.length,
      osDistribution,
      provisioningConfigs: this.provisioningConfigs.size,
      activeMetrics: Array.from(this.metrics.values()).reduce((sum, metrics) => sum + metrics.length, 0)
    };
  }
}

/**
 * Initialize Host Management service middleware
 */
export const initializeHostManagement = async (c: Context, next: () => Promise<void>) => {
  const sshService = c.get('sshService');

  if (!sshService) {
    console.error('SSH service not initialized for host management');
    throw new Error('SSH service required for host management');
  }

  const hostManagementService = new HostManagementService(sshService);
  c.set('hostManagementService', hostManagementService);

  await next();
};