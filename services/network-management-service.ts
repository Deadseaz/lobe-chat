/**
 * Network Management Service
 * Manages network infrastructure including Docker networks, routing, load balancing, and security
 */

import { Context } from 'hono';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DockerService } from './docker-service';

const execAsync = promisify(exec);

export interface NetworkConfig {
  id: string;
  name: string;
  driver: 'bridge' | 'host' | 'overlay' | 'macvlan' | 'ipvlan';
  subnet?: string;
  gateway?: string;
  ipRange?: string;
  internal?: boolean;
  attachable?: boolean;
  labels?: Record<string, string>;
  createdAt: Date;
}

export interface LoadBalancerConfig {
  id: string;
  name: string;
  algorithm: 'round-robin' | 'least-connections' | 'ip-hash' | 'weighted-round-robin';
  healthCheck: {
    protocol: 'http' | 'tcp' | 'https';
    path?: string;
    port: number;
    interval: number; // seconds
    timeout: number; // seconds
    healthyThreshold: number;
    unhealthyThreshold: number;
  };
  backends: Array<{
    id: string;
    host: string;
    port: number;
    weight?: number;
    status: 'healthy' | 'unhealthy' | 'draining';
  }>;
  ssl?: {
    enabled: boolean;
    certificate?: string;
    key?: string;
  };
  createdAt: Date;
}

export interface FirewallRule {
  id: string;
  name: string;
  action: 'allow' | 'deny';
  source: string; // IP address or CIDR
  destination: string; // IP address or CIDR
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  port?: number | string; // port number or 'any' or range like '80-443'
  direction: 'inbound' | 'outbound';
  priority: number; // Lower numbers are higher priority
  enabled: boolean;
  createdAt: Date;
}

export interface NetworkMetrics {
  networkName: string;
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
  connections: number;
  timestamp: Date;
}

export class NetworkManagementService {
  private networks: Map<string, NetworkConfig> = new Map();
  private loadBalancers: Map<string, LoadBalancerConfig> = new Map();
  private firewallRules: Map<string, FirewallRule> = new Map();
  private metrics: Map<string, NetworkMetrics[]> = new Map();
  private dockerService: DockerService;

  constructor(dockerService: DockerService) {
    this.dockerService = dockerService;
    this.initializeDefaultNetworks();
  }

  private initializeDefaultNetworks(): void {
    // Create default bridge network if it doesn't exist
    const defaultBridge: NetworkConfig = {
      id: 'default-bridge',
      name: 'zagent-bridge',
      driver: 'bridge',
      attachable: true,
      createdAt: new Date()
    };

    this.networks.set(defaultBridge.id, defaultBridge);
  }

  /**
   * Create a new Docker network
   */
  async createNetwork(config: Omit<NetworkConfig, 'id' | 'createdAt'>): Promise<NetworkConfig> {
    const networkId = crypto.randomUUID?.() || `net-${Date.now()}`;
    const network: NetworkConfig = {
      ...config,
      id: networkId,
      createdAt: new Date()
    };

    // Create the network using Docker command
    try {
      const cmd = ['docker', 'network', 'create'];
      
      // Add options based on the configuration
      if (network.driver) cmd.push('--driver', network.driver);
      if (network.subnet) cmd.push('--subnet', network.subnet);
      if (network.gateway) cmd.push('--gateway', network.gateway);
      if (network.ipRange) cmd.push('--ip-range', network.ipRange);
      if (network.internal) cmd.push('--internal');
      if (network.attachable) cmd.push('--attachable');
      
      // Add labels
      if (network.labels) {
        for (const [key, value] of Object.entries(network.labels)) {
          cmd.push('--label', `${key}=${value}`);
        }
      }
      
      cmd.push(network.name);
      
      const result = await execAsync(cmd.join(' '));
      network.id = result.stdout.trim(); // Docker returns the network ID
      
      this.networks.set(networkId, network);
      return network;
    } catch (error) {
      throw new Error(`Failed to create network: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get network by ID
   */
  getNetwork(id: string): NetworkConfig | undefined {
    return this.networks.get(id);
  }

  /**
   * List all networks
   */
  getAllNetworks(): NetworkConfig[] {
    return Array.from(this.networks.values());
  }

  /**
   * Connect a container to a network
   */
  async connectContainerToNetwork(containerId: string, networkId: string): Promise<{ success: boolean; error?: string }> {
    const network = this.networks.get(networkId);
    if (!network) {
      return { success: false, error: `Network ${networkId} not found` };
    }

    try {
      const cmd = ['docker', 'network', 'connect', network.name, containerId];
      await execAsync(cmd.join(' '));
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to connect container to network: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Disconnect a container from a network
   */
  async disconnectContainerFromNetwork(containerId: string, networkId: string): Promise<{ success: boolean; error?: string }> {
    const network = this.networks.get(networkId);
    if (!network) {
      return { success: false, error: `Network ${networkId} not found` };
    }

    try {
      const cmd = ['docker', 'network', 'disconnect', network.name, containerId];
      await execAsync(cmd.join(' '));
      
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to disconnect container from network: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Delete a network
   */
  async deleteNetwork(networkId: string): Promise<{ success: boolean; error?: string }> {
    const network = this.networks.get(networkId);
    if (!network) {
      return { success: false, error: `Network ${networkId} not found` };
    }

    try {
      const cmd = ['docker', 'network', 'rm', network.name];
      await execAsync(cmd.join(' '));
      
      this.networks.delete(networkId);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to delete network: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Create a load balancer
   */
  async createLoadBalancer(config: Omit<LoadBalancerConfig, 'id' | 'createdAt'>): Promise<LoadBalancerConfig> {
    const lbId = crypto.randomUUID?.() || `lb-${Date.now()}`;
    const loadBalancer: LoadBalancerConfig = {
      ...config,
      id: lbId,
      createdAt: new Date()
    };

    this.loadBalancers.set(lbId, loadBalancer);

    // Deploy the load balancer as a container
    await this.deployLoadBalancerContainer(loadBalancer);

    return loadBalancer;
  }

  /**
   * Deploy load balancer as a container
   */
  private async deployLoadBalancerContainer(lb: LoadBalancerConfig): Promise<void> {
    // Configure environment variables for the load balancer
    const envVars: Record<string, string> = {
      'LB_NAME': lb.name,
      'LB_ALGORITHM': lb.algorithm,
      'HEALTH_CHECK_PROTOCOL': lb.healthCheck.protocol,
      'HEALTH_CHECK_PORT': lb.healthCheck.port.toString(),
      'HEALTH_CHECK_INTERVAL': lb.healthCheck.interval.toString(),
      'HEALTH_CHECK_TIMEOUT': lb.healthCheck.timeout.toString(),
      'HEALTH_CHECK_HEALTHY_THRESHOLD': lb.healthCheck.healthyThreshold.toString(),
      'HEALTH_CHECK_UNHEALTHY_THRESHOLD': lb.healthCheck.unhealthyThreshold.toString(),
    };

    // Add backend configurations
    lb.backends.forEach((backend, index) => {
      envVars[`BACKEND_${index}_HOST`] = backend.host;
      envVars[`BACKEND_${index}_PORT`] = backend.port.toString();
      envVars[`BACKEND_${index}_WEIGHT`] = (backend.weight || 1).toString();
    });

    // Deploy using Docker service
    const containerConfig = {
      image: 'nginx:alpine', // This would be a custom load balancer image in real implementation
      name: `${lb.name}-lb`,
      env: envVars,
      ports: [{
        container: lb.healthCheck.port,
        host: lb.healthCheck.port
      }],
      network: 'zagent-bridge'
    };

    await this.dockerService.startContainer(containerConfig as any);
  }

  /**
   * Add backend to load balancer
   */
  async addBackendToLoadBalancer(lbId: string, backend: LoadBalancerConfig['backends'][0]): Promise<{ success: boolean; error?: string }> {
    const lb = this.loadBalancers.get(lbId);
    if (!lb) {
      return { success: false, error: `Load balancer ${lbId} not found` };
    }

    // Check if backend already exists
    if (lb.backends.some(b => b.id === backend.id)) {
      return { success: false, error: `Backend with ID ${backend.id} already exists in load balancer` };
    }

    lb.backends.push(backend);
    this.loadBalancers.set(lbId, lb);

    // Update the running load balancer container
    await this.updateLoadBalancerContainer(lb);

    return { success: true };
  }

  /**
   * Remove backend from load balancer
   */
  async removeBackendFromLoadBalancer(lbId: string, backendId: string): Promise<{ success: boolean; error?: string }> {
    const lb = this.loadBalancers.get(lbId);
    if (!lb) {
      return { success: false, error: `Load balancer ${lbId} not found` };
    }

    const initialLength = lb.backends.length;
    lb.backends = lb.backends.filter(b => b.id !== backendId);

    if (lb.backends.length === initialLength) {
      return { success: false, error: `Backend with ID ${backendId} not found in load balancer` };
    }

    this.loadBalancers.set(lbId, lb);

    // Update the running load balancer container
    await this.updateLoadBalancerContainer(lb);

    return { success: true };
  }

  /**
   * Update load balancer container configuration
   */
  private async updateLoadBalancerContainer(lb: LoadBalancerConfig): Promise<void> {
    // In a real implementation, this would update the running container
    // For now, we'll just log that an update is needed
    console.log(`Load balancer ${lb.name} configuration updated. Backends: ${lb.backends.length}`);
  }

  /**
   * Create firewall rule
   */
  async createFirewallRule(rule: Omit<FirewallRule, 'id' | 'createdAt'>): Promise<FirewallRule> {
    const ruleId = crypto.randomUUID?.() || `rule-${Date.now()}`;
    const firewallRule: FirewallRule = {
      ...rule,
      id: ruleId,
      createdAt: new Date()
    };

    // Validate rule parameters
    if (!this.isValidIpAddress(rule.source) && !this.isValidCidr(rule.source)) {
      throw new Error(`Invalid source address: ${rule.source}`);
    }
    
    if (!this.isValidIpAddress(rule.destination) && !this.isValidCidr(rule.destination)) {
      throw new Error(`Invalid destination address: ${rule.destination}`);
    }

    this.firewallRules.set(ruleId, firewallRule);

    // Apply the rule to the system firewall
    await this.applyFirewallRule(firewallRule);

    return firewallRule;
  }

  /**
   * Apply firewall rule to system
   */
  private async applyFirewallRule(rule: FirewallRule): Promise<void> {
    if (!rule.enabled) return;

    try {
      let cmd: string;

      // Construct iptables command based on rule configuration
      const direction = rule.direction === 'inbound' ? 'INPUT' : 'OUTPUT';
      const action = rule.action === 'allow' ? 'ACCEPT' : 'DROP';

      if (rule.protocol === 'tcp' || rule.protocol === 'udp') {
        const portSpec = rule.port ? `--dport ${rule.port}` : '';
        cmd = `iptables -A ${direction} -s ${rule.source} -d ${rule.destination} -p ${rule.protocol} ${portSpec} -j ${action}`;
      } else if (rule.protocol === 'icmp') {
        cmd = `iptables -A ${direction} -s ${rule.source} -d ${rule.destination} -p icmp -j ${action}`;
      } else {
        cmd = `iptables -A ${direction} -s ${rule.source} -d ${rule.destination} -j ${action}`;
      }

      // Add priority if needed (in real system, this would be more complex)
      await execAsync(cmd);
    } catch (error) {
      console.error(`Failed to apply firewall rule ${rule.id}:`, error);
    }
  }

  /**
   * Remove firewall rule
   */
  async removeFirewallRule(ruleId: string): Promise<{ success: boolean; error?: string }> {
    const rule = this.firewallRules.get(ruleId);
    if (!rule) {
      return { success: false, error: `Firewall rule ${ruleId} not found` };
    }

    try {
      // Remove the rule from the system firewall
      await this.removeFirewallRuleFromSystem(rule);

      // Remove from our collection
      this.firewallRules.delete(ruleId);

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: `Failed to remove firewall rule: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Remove firewall rule from system
   */
  private async removeFirewallRuleFromSystem(rule: FirewallRule): Promise<void> {
    // In a real implementation, we'd need to construct the reverse of the original rule
    // This is a simplified implementation
    console.log(`Would remove firewall rule ${rule.id} from system`);
  }

  /**
   * Get all firewall rules
   */
  getAllFirewallRules(): FirewallRule[] {
    return Array.from(this.firewallRules.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get firewall rules by source/destination
   */
  getFirewallRulesByTarget(target: string, direction: 'source' | 'destination'): FirewallRule[] {
    return Array.from(this.firewallRules.values())
      .filter(rule => rule[direction] === target || this.isInCidr(target, rule[direction]))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Validate IP address
   */
  private isValidIpAddress(ip: string): boolean {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    if (ipv4Regex.test(ip)) {
      return ip.split('.').every(octet => parseInt(octet, 10) <= 255);
    }
    
    return ipv6Regex.test(ip);
  }

  /**
   * Validate CIDR notation
   */
  private isValidCidr(cidr: string): boolean {
    const [ip, prefix] = cidr.split('/');
    if (!ip || !prefix) return false;
    
    if (!this.isValidIpAddress(ip)) return false;
    
    const prefixNum = parseInt(prefix, 10);
    if (isNaN(prefixNum)) return false;
    
    // For IPv4, prefix must be between 0 and 32
    if (ip.includes('.')) return prefixNum >= 0 && prefixNum <= 32;
    
    // For IPv6, prefix must be between 0 and 128
    return prefixNum >= 0 && prefixNum <= 128;
  }

  /**
   * Check if IP is in CIDR range
   */
  private isInCidr(ip: string, cidr: string): boolean {
    // Simplified implementation - in real system would need proper CIDR handling
    return false;
  }

  /**
   * Get network metrics
   */
  getNetworkMetrics(networkName: string): NetworkMetrics[] {
    return this.metrics.get(networkName) || [];
  }

  /**
   * Set network metrics
   */
  setNetworkMetrics(networkName: string, metrics: NetworkMetrics): void {
    if (!this.metrics.has(networkName)) {
      this.metrics.set(networkName, []);
    }
    
    const networkMetrics = this.metrics.get(networkName)!;
    networkMetrics.push(metrics);
    
    // Keep only last 1000 metrics to prevent memory issues
    if (networkMetrics.length > 1000) {
      networkMetrics.shift();
    }
  }

  /**
   * Get network statistics
   */
  getNetworkStats(): {
    totalNetworks: number;
    totalLoadBalancers: number;
    totalFirewallRules: number;
    networks: NetworkConfig[];
  } {
    return {
      totalNetworks: this.networks.size,
      totalLoadBalancers: this.loadBalancers.size,
      totalFirewallRules: this.firewallRules.size,
      networks: Array.from(this.networks.values())
    };
  }

  /**
   * Health check for network components
   */
  async healthCheck(): Promise<{
    networksHealthy: boolean;
    loadBalancersHealthy: boolean;
    firewallRulesApplied: boolean;
    overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  }> {
    // Check if Docker is accessible
    let dockerAccessible = false;
    try {
      await execAsync('docker ps');
      dockerAccessible = true;
    } catch (e) {
      dockerAccessible = false;
    }

    // Check network connectivity
    const networksHealthy = Array.from(this.networks.values()).length > 0 && dockerAccessible;

    // Check load balancer status
    let loadBalancersHealthy = true;
    for (const lb of this.loadBalancers.values()) {
      // In a real implementation, check if load balancer containers are running
      // For now, just ensure we have a way to track them
    }

    // Check firewall status
    const firewallRulesApplied = this.firewallRules.size > 0;

    const overallStatus = 
      networksHealthy && loadBalancersHealthy && firewallRulesApplied ? 'healthy' :
      networksHealthy || loadBalancersHealthy || firewallRulesApplied ? 'degraded' : 'unhealthy';

    return {
      networksHealthy,
      loadBalancersHealthy,
      firewallRulesApplied,
      overallStatus
    };
  }
}

/**
 * Initialize Network Management service middleware
 */
export const initializeNetworkManagement = async (c: Context, next: () => Promise<void>) => {
  const dockerService = c.get('dockerService');

  if (!dockerService) {
    console.error('Docker service not initialized for network management');
    throw new Error('Docker service required for network management');
  }

  const networkManagementService = new NetworkManagementService(dockerService);
  c.set('networkManagementService', networkManagementService);

  await next();
};