/**
 * Enhanced Monitoring and Alerting Service
 * Comprehensive monitoring, alerting, and dashboard system for infrastructure
 */

import { Context } from 'hono';
import { AgentSystem } from '../agents/AgentSystem';
import { SubAgentManagerService } from './sub-agent-manager';
import { NetworkManagementService } from './network-management-service';
import { HostManagementService } from './host-management-service';
import { CloudflareAIGatewayService } from './ai-gateway-service';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface Metric {
  id: string;
  name: string;
  value: number;
  unit: string;
  labels: Record<string, string>;
  timestamp: Date;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: {
    metric: string;
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'ne';
    threshold: number;
    window: number; // seconds
  };
  severity: 'critical' | 'high' | 'medium' | 'low';
  notificationChannels: string[];
  enabled: boolean;
  createdAt: Date;
}

export interface Alert {
  id: string;
  ruleId: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'resolved' | 'acknowledged';
  value: number;
  threshold: number;
  labels: Record<string, string>;
  timestamp: Date;
  resolvedAt?: Date;
}

export interface DashboardWidget {
  id: string;
  title: string;
  type: 'line' | 'bar' | 'gauge' | 'table' | 'metric';
  metric: string;
  labels?: Record<string, string>;
  refreshInterval: number; // milliseconds
  position: { x: number; y: number; width: number; height: number };
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'discord';
  config: Record<string, any>;
  enabled: boolean;
  createdAt: Date;
}

export class MonitoringAlertingService {
  private metrics: Map<string, Metric[]> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private notificationChannels: Map<string, NotificationChannel> = new Map();
  private dashboardWidgets: Map<string, DashboardWidget[]> = new Map();
  private agentSystem: AgentSystem;
  private subAgentManager: SubAgentManagerService;
  private networkService: NetworkManagementService;
  private hostService: HostManagementService;
  private aiGatewayService: CloudflareAIGatewayService;

  constructor(
    agentSystem: AgentSystem,
    subAgentManager: SubAgentManagerService,
    networkService: NetworkManagementService,
    hostService: HostManagementService,
    aiGatewayService: CloudflareAIGatewayService
  ) {
    this.agentSystem = agentSystem;
    this.subAgentManager = subAgentManager;
    this.networkService = networkService;
    this.hostService = hostService;
    this.aiGatewayService = aiGatewayService;

    this.startMonitoring();
    this.startAlertEvaluation();
  }

  /**
   * Start metrics collection
   */
  private startMonitoring(): void {
    // Collect system metrics every 30 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Collect custom application metrics every minute
    setInterval(() => {
      this.collectApplicationMetrics();
    }, 60000);

    // Collect infrastructure metrics every minute
    setInterval(() => {
      this.collectInfrastructureMetrics();
    }, 60000);
  }

  /**
   * Start alert evaluation
   */
  private startAlertEvaluation(): void {
    // Evaluate alerts every 15 seconds
    setInterval(() => {
      this.evaluateAlerts();
    }, 15000);
  }

  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      // Get system-wide metrics
      const cpuUsage = await this.getSystemCpuUsage();
      const memoryUsage = await this.getSystemMemoryUsage();
      const diskUsage = await this.getSystemDiskUsage();
      const networkStats = await this.getSystemNetworkStats();

      // Record metrics
      this.recordMetric('system.cpu.usage', cpuUsage, { unit: 'percentage' });
      this.recordMetric('system.memory.usage', memoryUsage, { unit: 'percentage' });
      this.recordMetric('system.disk.usage', diskUsage, { unit: 'percentage' });
      this.recordMetric('system.network.bytes_in', networkStats.bytesIn, { unit: 'bytes' });
      this.recordMetric('system.network.bytes_out', networkStats.bytesOut, { unit: 'bytes' });

      // Collect agent-specific metrics
      const agentMetrics = this.agentSystem.getSystemHealth();
      this.recordMetric('agents.total', agentMetrics.totalAgents, { unit: 'count' });
      this.recordMetric('agents.active', agentMetrics.activeAgents, { unit: 'count' });
      this.recordMetric('agents.idle', agentMetrics.idleAgents, { unit: 'count' });
      this.recordMetric('agents.busy', agentMetrics.busyAgents, { unit: 'count' });
      this.recordMetric('agents.error', agentMetrics.errorAgents, { unit: 'count' });
      this.recordMetric('tasks.active', agentMetrics.activeTasks, { unit: 'count' });
      this.recordMetric('tasks.queued', agentMetrics.queuedTasks, { unit: 'count' });
    } catch (error) {
      console.error('Error collecting system metrics:', error);
    }
  }

  /**
   * Collect application metrics
   */
  private async collectApplicationMetrics(): Promise<void> {
    try {
      // Get AI Gateway metrics
      const aiGatewayStats = this.aiGatewayService.getAIGatewayStats();
      this.recordMetric('ai_gateway.models.total', aiGatewayStats.totalModels, { unit: 'count' });
      this.recordMetric('ai_gateway.models.active', aiGatewayStats.activeModels, { unit: 'count' });
      this.recordMetric('ai_gateway.requests.total', aiGatewayStats.totalRequests, { unit: 'count' });
      this.recordMetric('ai_gateway.success_rate', aiGatewayStats.successRate, { unit: 'percentage' });
      this.recordMetric('ai_gateway.total_cost', aiGatewayStats.totalCost, { unit: 'usd' });

      // Get sub-agent metrics
      const subAgentMetrics = this.subAgentManager.getSystemMetrics();
      this.recordMetric('sub_agents.total', subAgentMetrics.totalAgents, { unit: 'count' });
      this.recordMetric('sub_agents.running', subAgentMetrics.runningAgents, { unit: 'count' });
      this.recordMetric('sub_agents.healthy', subAgentMetrics.healthyAgents, { unit: 'count' });
      this.recordMetric('sub_agents.unhealthy', subAgentMetrics.unhealthyAgents, { unit: 'count' });

      // Get network metrics
      const networkStats = this.networkService.getNetworkStats();
      this.recordMetric('networks.total', networkStats.totalNetworks, { unit: 'count' });
      this.recordMetric('load_balancers.total', networkStats.totalLoadBalancers, { unit: 'count' });
      this.recordMetric('firewall_rules.total', networkStats.totalFirewallRules, { unit: 'count' });

      // Get host metrics
      const hostStats = this.hostService.getHostStats();
      this.recordMetric('hosts.total', hostStats.totalHosts, { unit: 'count' });
      this.recordMetric('hosts.linux', hostStats.osDistribution.linux || 0, { unit: 'count' });
      this.recordMetric('hosts.windows', hostStats.osDistribution.windows || 0, { unit: 'count' });
      this.recordMetric('hosts.macos', hostStats.osDistribution.macos || 0, { unit: 'count' });
    } catch (error) {
      console.error('Error collecting application metrics:', error);
    }
  }

  /**
   * Collect infrastructure metrics
   */
  private async collectInfrastructureMetrics(): Promise<void> {
    try {
      // Get Docker-related metrics
      const dockerInfo = await execAsync('docker info');
      const dockerPs = await execAsync('docker ps -q');
      const dockerImages = await execAsync('docker images -q');
      const dockerVolumes = await execAsync('docker volume ls -q');
      const dockerNetworks = await execAsync('docker network ls -q');

      this.recordMetric('docker.containers.running', dockerPs.stdout.trim().split('\n').filter(Boolean).length, { unit: 'count' });
      this.recordMetric('docker.images.total', dockerImages.stdout.trim().split('\n').filter(Boolean).length, { unit: 'count' });
      this.recordMetric('docker.volumes.total', dockerVolumes.stdout.trim().split('\n').filter(Boolean).length, { unit: 'count' });
      this.recordMetric('docker.networks.total', dockerNetworks.stdout.trim().split('\n').filter(Boolean).length, { unit: 'count' });

      // Get host-specific metrics if available
      const allHosts = this.hostService.getAllHosts();
      for (const host of allHosts) {
        try {
          const hostMetrics = this.hostService.getHostMetrics(host.id, 1);
          if (hostMetrics.length > 0) {
            const latest = hostMetrics[0];
            this.recordMetric('host.cpu.usage', latest.cpuUsage, { unit: 'percentage', host: host.name });
            this.recordMetric('host.memory.usage', latest.memoryUsage, { unit: 'percentage', host: host.name });
            this.recordMetric('host.disk.usage', latest.diskUsage, { unit: 'percentage', host: host.name });
            this.recordMetric('host.load.1min', latest.loadAverage[0], { unit: 'load', host: host.name });
            this.recordMetric('host.uptime', latest.uptime, { unit: 'seconds', host: host.name });
          }
        } catch (error) {
          // Host might be unreachable, continue with other hosts
          console.warn(`Could not get metrics for host ${host.name}:`, error);
        }
      }
    } catch (error) {
      console.error('Error collecting infrastructure metrics:', error);
    }
  }

  /**
   * Get system CPU usage
   */
  private async getSystemCpuUsage(): Promise<number> {
    try {
      const result = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | sed 's/%us//' | sed 's/,//'");
      return parseFloat(result.stdout.trim()) || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get system memory usage
   */
  private async getSystemMemoryUsage(): Promise<number> {
    try {
      const result = await execAsync("free | grep Mem | awk '{printf \"%.2f\", $3/$2 * 100.0}'");
      return parseFloat(result.stdout.trim()) || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get system disk usage
   */
  private async getSystemDiskUsage(): Promise<number> {
    try {
      const result = await execAsync("df / | tail -1 | awk '{print $5}' | sed 's/%//'");
      return parseFloat(result.stdout.trim()) || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get system network stats
   */
  private async getSystemNetworkStats(): Promise<{ bytesIn: number; bytesOut: number }> {
    try {
      const result = await execAsync("cat /proc/net/dev | grep -v 'lo\\|face' | awk '{print $2, $10}' | head -1");
      const [bytesIn, bytesOut] = result.stdout.trim().split(' ').map(val => parseInt(val) || 0);
      return { bytesIn, bytesOut };
    } catch (error) {
      return { bytesIn: 0, bytesOut: 0 };
    }
  }

  /**
   * Record a metric value
   */
  recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
    const metricId = crypto.randomUUID?.() || `metric-${Date.now()}`;

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metrics = this.metrics.get(name)!;
    const newMetric: Metric = {
      id: metricId,
      name,
      value,
      unit: labels.unit || 'count',
      labels: { ...labels },
      timestamp: new Date()
    };

    metrics.push(newMetric);

    // Keep only last 1000 metrics per name to prevent memory issues
    if (metrics.length > 1000) {
      metrics.shift();
    }
  }

  /**
   * Create an alert rule
   */
  async createAlertRule(rule: Omit<AlertRule, 'id' | 'createdAt'>): Promise<AlertRule> {
    const ruleId = crypto.randomUUID?.() || `rule-${Date.now()}`;
    const alertRule: AlertRule = {
      ...rule,
      id: ruleId,
      createdAt: new Date()
    };

    this.alertRules.set(ruleId, alertRule);
    return alertRule;
  }

  /**
   * Get alert rule by ID
   */
  getAlertRule(ruleId: string): AlertRule | undefined {
    return this.alertRules.get(ruleId);
  }

  /**
   * Get all alert rules
   */
  getAllAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Evaluate alert rules and trigger alerts if conditions are met
   */
  private evaluateAlerts(): void {
    for (const [ruleId, rule] of this.alertRules) {
      if (!rule.enabled) continue;

      try {
        // Get the metrics that match the rule condition
        const relevantMetrics = this.getMetricValues(rule.condition.metric, rule.condition.window);

        if (relevantMetrics.length === 0) continue;

        // Calculate the aggregate value based on the window
        let aggregateValue: number;
        if (rule.condition.window && relevantMetrics.length > 1) {
          // Use average over the window period
          aggregateValue = relevantMetrics.reduce((sum, m) => sum + m.value, 0) / relevantMetrics.length;
        } else {
          // Use the most recent value
          aggregateValue = relevantMetrics[relevantMetrics.length - 1].value;
        }

        // Check if condition is met
        let conditionMet = false;
        switch (rule.condition.operator) {
          case 'gt':
            conditionMet = aggregateValue > rule.condition.threshold;
            break;
          case 'lt':
            conditionMet = aggregateValue < rule.condition.threshold;
            break;
          case 'gte':
            conditionMet = aggregateValue >= rule.condition.threshold;
            break;
          case 'lte':
            conditionMet = aggregateValue <= rule.condition.threshold;
            break;
          case 'eq':
            conditionMet = aggregateValue === rule.condition.threshold;
            break;
          case 'ne':
            conditionMet = aggregateValue !== rule.condition.threshold;
            break;
        }

        if (conditionMet) {
          // Check if alert is already active
          const existingAlert = Array.from(this.activeAlerts.values()).find(
            alert => alert.ruleId === ruleId && alert.status === 'active'
          );

          if (!existingAlert) {
            // Create new alert
            this.createAlert({
              ruleId,
              name: rule.name,
              description: rule.description,
              severity: rule.severity,
              status: 'active',
              value: aggregateValue,
              threshold: rule.condition.threshold,
              labels: { ...rule.condition },
              timestamp: new Date()
            });
          }
        } else {
          // Check if the alert is currently active and should be resolved
          const activeAlert = Array.from(this.activeAlerts.values()).find(
            alert => alert.ruleId === ruleId && alert.status === 'active'
          );

          if (activeAlert) {
            // Resolve the alert
            activeAlert.status = 'resolved';
            activeAlert.resolvedAt = new Date();
          }
        }
      } catch (error) {
        console.error(`Error evaluating alert rule ${ruleId}:`, error);
      }
    }
  }

  /**
   * Get metric values within a time window
   */
  private getMetricValues(metricName: string, windowSeconds: number): Metric[] {
    const allMetrics = this.metrics.get(metricName) || [];
    const windowStart = new Date(Date.now() - (windowSeconds * 1000));

    return allMetrics.filter(metric => metric.timestamp >= windowStart);
  }

  /**
   * Create an alert
   */
  private createAlert(alert: Omit<Alert, 'id'>): Alert {
    const alertId = crypto.randomUUID?.() || `alert-${Date.now()}`;
    const newAlert: Alert = {
      ...alert,
      id: alertId
    };

    this.activeAlerts.set(alertId, newAlert);

    // Send notifications
    this.sendAlertNotifications(newAlert);

    return newAlert;
  }

  /**
   * Send alert notifications
   */
  private async sendAlertNotifications(alert: Alert): Promise<void> {
    const rule = this.alertRules.get(alert.ruleId);
    if (!rule) return;

    // Send notifications to all configured channels
    for (const channelId of rule.notificationChannels) {
      const channel = this.notificationChannels.get(channelId);
      if (!channel || !channel.enabled) continue;

      try {
        await this.sendNotification(channel, alert);
      } catch (error) {
        console.error(`Failed to send notification via ${channelId}:`, error);
      }
    }
  }

  /**
   * Send notification via a specific channel
   */
  private async sendNotification(channel: NotificationChannel, alert: Alert): Promise<void> {
    switch (channel.type) {
      case 'email':
        await this.sendEmailNotification(channel, alert);
        break;
      case 'webhook':
        await this.sendWebhookNotification(channel, alert);
        break;
      case 'slack':
        await this.sendSlackNotification(channel, alert);
        break;
      case 'discord':
        await this.sendDiscordNotification(channel, alert);
        break;
      case 'pagerduty':
        await this.sendPagerDutyNotification(channel, alert);
        break;
      default:
        throw new Error(`Unsupported notification type: ${channel.type}`);
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(channel: NotificationChannel, alert: Alert): Promise<void> {
    // In a real implementation, this would send an email
    console.log(`Sending email notification: ${alert.name} - ${alert.description}`);
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(channel: NotificationChannel, alert: Alert): Promise<void> {
    const url = channel.config.url;
    if (!url) {
      throw new Error('Webhook URL not configured');
    }

    const payload = {
      alertId: alert.id,
      ruleName: alert.name,
      description: alert.description,
      severity: alert.severity,
      value: alert.value,
      threshold: alert.threshold,
      timestamp: alert.timestamp.toISOString()
    };

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...channel.config.headers
      },
      body: JSON.stringify(payload)
    });
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(channel: NotificationChannel, alert: Alert): Promise<void> {
    const webhookUrl = channel.config.webhookUrl;
    if (!webhookUrl) {
      throw new Error('Slack webhook URL not configured');
    }

    const message = {
      text: `:${alert.severity === 'critical' ? 'red_circle' : alert.severity === 'high' ? 'warning' : 'small_orange_diamond'} *${alert.severity.toUpperCase()} Alert: ${alert.name}*`,
      attachments: [
        {
          color: alert.severity === 'critical' ? 'danger' : alert.severity === 'high' ? 'warning' : '#FFA500',
          fields: [
            {
              title: 'Description',
              value: alert.description,
              short: false
            },
            {
              title: 'Current Value',
              value: alert.value.toString(),
              short: true
            },
            {
              title: 'Threshold',
              value: alert.threshold.toString(),
              short: true
            },
            {
              title: 'Time',
              value: alert.timestamp.toISOString(),
              short: true
            }
          ]
        }
      ]
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  }

  /**
   * Send Discord notification
   */
  private async sendDiscordNotification(channel: NotificationChannel, alert: Alert): Promise<void> {
    const webhookUrl = channel.config.webhookUrl;
    if (!webhookUrl) {
      throw new Error('Discord webhook URL not configured');
    }

    const color = alert.severity === 'critical' ? 0xFF0000 : alert.severity === 'high' ? 0xFFFF00 : 0xFFA500;

    const message = {
      embeds: [
        {
          title: `${alert.severity.toUpperCase()} Alert: ${alert.name}`,
          description: alert.description,
          color: color,
          fields: [
            {
              name: 'Current Value',
              value: alert.value.toString(),
              inline: true
            },
            {
              name: 'Threshold',
              value: alert.threshold.toString(),
              inline: true
            },
            {
              name: 'Time',
              value: alert.timestamp.toISOString(),
              inline: true
            }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  }

  /**
   * Send PagerDuty notification
   */
  private async sendPagerDutyNotification(channel: NotificationChannel, alert: Alert): Promise<void> {
    const routingKey = channel.config.routingKey;
    if (!routingKey) {
      throw new Error('PagerDuty routing key not configured');
    }

    const payload = {
      routing_key: routingKey,
      event_action: 'trigger',
      payload: {
        summary: `${alert.severity.toUpperCase()} Alert: ${alert.name} - ${alert.description}`,
        source: 'zagent-monitoring',
        severity: alert.severity === 'critical' ? 'critical' : 'error',
        custom_details: {
          value: alert.value,
          threshold: alert.threshold,
          timestamp: alert.timestamp.toISOString()
        }
      }
    };

    await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  }

  /**
   * Create a notification channel
   */
  async createNotificationChannel(channel: Omit<NotificationChannel, 'id' | 'createdAt'>): Promise<NotificationChannel> {
    const channelId = crypto.randomUUID?.() || `channel-${Date.now()}`;
    const notificationChannel: NotificationChannel = {
      ...channel,
      id: channelId,
      createdAt: new Date()
    };

    this.notificationChannels.set(channelId, notificationChannel);
    return notificationChannel;
  }

  /**
   * Create a dashboard widget
   */
  async createDashboardWidget(dashboardId: string, widget: Omit<DashboardWidget, 'id'>): Promise<DashboardWidget> {
    const widgetId = crypto.randomUUID?.() || `widget-${Date.now()}`;
    const newWidget: DashboardWidget = {
      ...widget,
      id: widgetId
    };

    if (!this.dashboardWidgets.has(dashboardId)) {
      this.dashboardWidgets.set(dashboardId, []);
    }

    const dashboard = this.dashboardWidgets.get(dashboardId)!;
    dashboard.push(newWidget);

    return newWidget;
  }

  /**
   * Get dashboard widgets
   */
  getDashboardWidgets(dashboardId: string): DashboardWidget[] {
    return this.dashboardWidgets.get(dashboardId) || [];
  }

  /**
   * Get metrics for dashboard
   */
  getDashboardMetrics(metricName: string, labels?: Record<string, string>, limit: number = 100): Metric[] {
    const allMetrics = this.metrics.get(metricName) || [];
    
    let filteredMetrics = allMetrics;
    
    // Filter by labels if provided
    if (labels) {
      filteredMetrics = allMetrics.filter(metric => {
        return Object.entries(labels).every(([key, value]) => 
          metric.labels[key] === value
        );
      });
    }
    
    // Return last N metrics
    return filteredMetrics.slice(-limit);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => alert.status === 'active');
  }

  /**
   * Get resolved alerts
   */
  getResolvedAlerts(limit: number = 50): Alert[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => alert.status !== 'active')
      .slice(-limit);
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.status !== 'active') {
      return false;
    }

    alert.status = 'acknowledged';
    return true;
  }

  /**
   * Get monitoring statistics
   */
  getMonitoringStats(): {
    totalMetrics: number;
    totalAlerts: number;
    activeAlerts: number;
    totalAlertRules: number;
    totalNotificationChannels: number;
    totalDashboardWidgets: number;
  } {
    const totalMetrics = Array.from(this.metrics.values()).reduce((sum, metrics) => sum + metrics.length, 0);

    return {
      totalMetrics,
      totalAlerts: this.activeAlerts.size,
      activeAlerts: Array.from(this.activeAlerts.values()).filter(a => a.status === 'active').length,
      totalAlertRules: this.alertRules.size,
      totalNotificationChannels: this.notificationChannels.size,
      totalDashboardWidgets: Array.from(this.dashboardWidgets.values()).reduce((sum, widgets) => sum + widgets.length, 0)
    };
  }

  /**
   * Health check for monitoring system
   */
  async healthCheck(): Promise<{
    systemHealthy: boolean;
    components: {
      metricsCollection: boolean;
      alerting: boolean;
      notifications: boolean;
      dashboard: boolean;
    };
    metricsCollected: number;
    activeAlerts: number;
    timestamp: Date;
  }> {
    const metricsCount = Array.from(this.metrics.values()).reduce((sum, metrics) => sum + metrics.length, 0);
    const activeAlertsCount = Array.from(this.activeAlerts.values()).filter(a => a.status === 'active').length;

    return {
      systemHealthy: true, // In a real system, we'd check more thoroughly
      components: {
        metricsCollection: metricsCount > 0,
        alerting: true, // Always enabled
        notifications: this.notificationChannels.size > 0,
        dashboard: Array.from(this.dashboardWidgets.values()).some(w => w.length > 0)
      },
      metricsCollected: metricsCount,
      activeAlerts: activeAlertsCount,
      timestamp: new Date()
    };
  }
}

/**
 * Initialize Monitoring and Alerting service middleware
 */
export const initializeMonitoringAlerting = async (
  c: Context, 
  next: () => Promise<void>
) => {
  const agentSystem = c.get('agentSystem');
  const subAgentManager = c.get('subAgentManager');
  const networkService = c.get('networkManagementService');
  const hostService = c.get('hostManagementService');
  const aiGatewayService = c.get('aiGatewayService');

  if (!agentSystem || !subAgentManager || !networkService || !hostService || !aiGatewayService) {
    console.error('Required services not initialized for monitoring');
    throw new Error('All required services must be initialized for monitoring system');
  }

  const monitoringService = new MonitoringAlertingService(
    agentSystem,
    subAgentManager,
    networkService,
    hostService,
    aiGatewayService
  );
  c.set('monitoringAlertingService', monitoringService);

  await next();
};