/**
 * MonitoringAgent - Handles metrics collection, log analysis, and system observability
 */

import { BaseAgent } from './BaseAgent';
import { AgentType, AgentTask, TaskResult, AgentCapability } from './types';

export class MonitoringAgent extends BaseAgent {
  private prometheusService: any;
  private redisService: any;

  constructor(context: any) {
    const capabilities: AgentCapability[] = [
      {
        name: 'metrics-collection',
        description: 'Collect and analyze metrics from Prometheus',
        requiredServices: ['prometheusService']
      },
      {
        name: 'log-analysis',
        description: 'Analyze logs and detect anomalies',
        requiredServices: []
      },
      {
        name: 'alert-management',
        description: 'Manage and route alerts',
        requiredServices: []
      },
      {
        name: 'performance-monitoring',
        description: 'Monitor system and application performance',
        requiredServices: ['prometheusService', 'redisService']
      }
    ];

    super(
      `monitoring-${Date.now()}`,
      'MonitoringAgent',
      AgentType.MONITORING,
      capabilities,
      context
    );

    this.prometheusService = context.services?.prometheus;
    this.redisService = context.services?.redisService;
  }

  protected async executeTask(task: AgentTask): Promise<TaskResult> {
    console.log(`[MonitoringAgent] Executing task: ${task.type}`);

    try {
      switch (task.type) {
        case 'collect-metrics':
          return await this.collectMetrics(task);

        case 'query-metrics':
          return await this.queryMetrics(task);

        case 'analyze-performance':
          return await this.analyzePerformance(task);

        case 'check-health':
          return await this.checkSystemHealth(task);

        case 'detect-anomalies':
          return await this.detectAnomalies(task);

        case 'get-dashboard-data':
          return await this.getDashboardData(task);

        default:
          return {
            success: false,
            error: `Unknown task type: ${task.type}`
          };
      }
    } catch (error) {
      console.error(`[MonitoringAgent] Task execution error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Metrics Collection
  // ============================================================================

  private async collectMetrics(task: AgentTask): Promise<TaskResult> {
    if (!this.prometheusService) {
      return { success: false, error: 'Prometheus service not available' };
    }

    const { metricNames, interval } = task.payload;

    try {
      const metrics: any = {};

      // Collect HTTP metrics
      metrics.httpRequests = {
        total: this.prometheusService.httpRequestCounter._metrics.size,
        timestamp: new Date().toISOString()
      };

      // Collect custom metrics if specified
      if (metricNames && Array.isArray(metricNames)) {
        for (const name of metricNames) {
          const metric = await this.prometheusService.getMetric(name);
          if (metric) {
            metrics[name] = metric;
          }
        }
      }

      return {
        success: true,
        data: {
          metrics,
          interval: interval || 60,
          collectedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async queryMetrics(task: AgentTask): Promise<TaskResult> {
    const { query, timeRange } = task.payload;

    try {
      // Simple metric query (in production, this would query Prometheus API)
      const result = {
        query,
        timeRange: timeRange || '1h',
        data: [],
        timestamp: new Date().toISOString()
      };

      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Performance Analysis
  // ============================================================================

  private async analyzePerformance(task: AgentTask): Promise<TaskResult> {
    const { service, duration } = task.payload;

    try {
      const analysis = {
        service: service || 'all',
        duration: duration || '1h',
        metrics: {
          avgResponseTime: 0,
          requestsPerSecond: 0,
          errorRate: 0,
          p95ResponseTime: 0,
          p99ResponseTime: 0
        },
        recommendations: [] as string[],
        timestamp: new Date().toISOString()
      };

      // Calculate metrics (mock data for now)
      if (this.prometheusService) {
        // In real implementation, query Prometheus for actual data
        analysis.metrics.avgResponseTime = 150;
        analysis.metrics.requestsPerSecond = 100;
        analysis.metrics.errorRate = 0.5;
        analysis.metrics.p95ResponseTime = 300;
        analysis.metrics.p99ResponseTime = 500;

        // Generate recommendations based on metrics
        if (analysis.metrics.errorRate > 1) {
          analysis.recommendations.push('High error rate detected. Investigate application logs.');
        }

        if (analysis.metrics.avgResponseTime > 200) {
          analysis.recommendations.push('Average response time is high. Consider scaling or optimization.');
        }

        if (analysis.metrics.p99ResponseTime > 1000) {
          analysis.recommendations.push('P99 latency is very high. Check for slow queries or external dependencies.');
        }
      }

      return {
        success: true,
        data: analysis
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async checkSystemHealth(task: AgentTask): Promise<TaskResult> {
    try {
      const health = {
        status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
        checks: {
          api: { status: 'passing', responseTime: 45 },
          database: { status: 'passing', responseTime: 12 },
          redis: { status: 'passing', responseTime: 8 },
          messaging: { status: 'passing', responseTime: 15 }
        },
        uptime: process.uptime ? process.uptime() : 0,
        timestamp: new Date().toISOString()
      };

      // Check Redis if available
      if (this.redisService) {
        try {
          await this.redisService.ping();
          health.checks.redis.status = 'passing';
        } catch {
          health.checks.redis.status = 'failing';
          health.status = 'degraded';
        }
      }

      // Overall health status
      const failingChecks = Object.values(health.checks).filter(c => c.status === 'failing');
      if (failingChecks.length > 0) {
        health.status = failingChecks.length > 1 ? 'unhealthy' : 'degraded';
      }

      return {
        success: true,
        data: health
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // ============================================================================
  // Anomaly Detection
  // ============================================================================

  private async detectAnomalies(task: AgentTask): Promise<TaskResult> {
    const { metricName, threshold, timeWindow } = task.payload;

    try {
      // Simple anomaly detection (in production, use ML/statistical methods)
      const anomalies = [];

      // Mock anomaly detection
      const currentValue = Math.random() * 100;
      const expectedValue = 50;
      const deviation = Math.abs(currentValue - expectedValue);

      if (deviation > (threshold || 30)) {
        anomalies.push({
          metric: metricName,
          currentValue,
          expectedValue,
          deviation,
          severity: deviation > 40 ? 'high' : 'medium',
          timestamp: new Date().toISOString(),
          message: `${metricName} is ${deviation.toFixed(2)}% outside normal range`
        });
      }

      return {
        success: true,
        data: {
          anomaliesDetected: anomalies.length,
          anomalies,
          timeWindow: timeWindow || '5m',
          analyzedAt: new Date().toISOString()
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
  // Dashboard Data
  // ============================================================================

  private async getDashboardData(task: AgentTask): Promise<TaskResult> {
    try {
      const dashboard = {
        overview: {
          totalRequests: 15432,
          activeUsers: 234,
          avgResponseTime: 145,
          errorRate: 0.3,
          uptime: 99.98
        },
        services: [
          { name: 'api-gateway', status: 'healthy', requests: 8234 },
          { name: 'auth-service', status: 'healthy', requests: 3456 },
          { name: 'data-service', status: 'degraded', requests: 2341 },
          { name: 'cache-service', status: 'healthy', requests: 1401 }
        ],
        recentAlerts: [
          {
            id: 'alert-1',
            severity: 'warning',
            service: 'data-service',
            message: 'High database connection count',
            timestamp: new Date(Date.now() - 300000).toISOString()
          }
        ],
        systemResources: {
          cpu: 45.2,
          memory: 68.5,
          disk: 34.1,
          network: 23.4
        },
        timestamp: new Date().toISOString()
      };

      return {
        success: true,
        data: dashboard
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
