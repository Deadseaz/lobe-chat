/**
 * Grafana & Prometheus Integration Service
 * Real-time metrics collection, visualization, and alerting
 * ZERO MOCKS - Full integration
 */

import { ConfigService } from '../shared/config.js';
import { register, Counter, Gauge, Histogram, Summary } from 'prom-client';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// INTERFACES
// ============================================================================

export interface PrometheusMetric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  help: string;
  labelNames?: string[];
}

export interface GrafanaDashboard {
  id?: string;
  uid?: string;
  title: string;
  panels: GrafanaPanel[];
  tags?: string[];
  refresh?: string;
  time?: { from: string; to: string };
}

export interface GrafanaPanel {
  id: number;
  title: string;
  type: 'graph' | 'stat' | 'gauge' | 'table' | 'heatmap' | 'logs';
  targets: GrafanaTarget[];
  gridPos: { x: number; y: number; w: number; h: number };
}

export interface GrafanaTarget {
  expr: string; // PromQL query
  legendFormat?: string;
  refId: string;
}

export interface GrafanaDataSource {
  name: string;
  type: string;
  url: string;
  access: 'proxy' | 'direct';
  basicAuth?: boolean;
  basicAuthUser?: string;
  basicAuthPassword?: string;
  jsonData?: any;
}

export interface AlertRule {
  name: string;
  expr: string; // PromQL expression
  duration: string; // e.g., "5m"
  severity: 'critical' | 'warning' | 'info';
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
}

// ============================================================================
// PROMETHEUS METRICS SERVICE
// ============================================================================

export class PrometheusMetricsService {
  private config: ConfigService;
  private metrics: Map<string, any> = new Map();

  // ZAgent-specific metrics
  private httpRequests: Counter;
  private httpDuration: Histogram;
  private activeConnections: Gauge;
  private workerInvocations: Counter;
  private d1Queries: Counter;
  private r2Operations: Counter;
  private kvOperations: Counter;
  private vectorSearches: Counter;
  private aiGatewayRequests: Counter;
  private aiGatewayCost: Counter;
  private deployments: Counter;
  private errors: Counter;

  constructor(configService: ConfigService) {
    this.config = configService;

    // Initialize core metrics
    this.httpRequests = new Counter({
      name: 'zagent_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code']
    });

    this.httpDuration = new Histogram({
      name: 'zagent_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route'],
      buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
    });

    this.activeConnections = new Gauge({
      name: 'zagent_active_connections',
      help: 'Number of active connections'
    });

    this.workerInvocations = new Counter({
      name: 'zagent_worker_invocations_total',
      help: 'Total number of Worker invocations',
      labelNames: ['worker_name', 'status']
    });

    this.d1Queries = new Counter({
      name: 'zagent_d1_queries_total',
      help: 'Total number of D1 database queries',
      labelNames: ['database', 'operation', 'status']
    });

    this.r2Operations = new Counter({
      name: 'zagent_r2_operations_total',
      help: 'Total number of R2 storage operations',
      labelNames: ['bucket', 'operation', 'status']
    });

    this.kvOperations = new Counter({
      name: 'zagent_kv_operations_total',
      help: 'Total number of KV operations',
      labelNames: ['namespace', 'operation', 'status']
    });

    this.vectorSearches = new Counter({
      name: 'zagent_vector_searches_total',
      help: 'Total number of vector searches',
      labelNames: ['index', 'status']
    });

    this.aiGatewayRequests = new Counter({
      name: 'zagent_ai_gateway_requests_total',
      help: 'Total number of AI Gateway requests',
      labelNames: ['provider', 'model', 'status']
    });

    this.aiGatewayCost = new Counter({
      name: 'zagent_ai_gateway_cost_usd',
      help: 'Total AI Gateway cost in USD',
      labelNames: ['provider', 'model']
    });

    this.deployments = new Counter({
      name: 'zagent_deployments_total',
      help: 'Total number of deployments',
      labelNames: ['environment', 'status']
    });

    this.errors = new Counter({
      name: 'zagent_errors_total',
      help: 'Total number of errors',
      labelNames: ['type', 'severity']
    });

    this.registerMetrics();
  }

  /**
   * Register custom metric
   */
  registerMetric(metric: PrometheusMetric): void {
    let metricInstance: any;

    switch (metric.type) {
      case 'counter':
        metricInstance = new Counter({
          name: metric.name,
          help: metric.help,
          labelNames: metric.labelNames
        });
        break;
      case 'gauge':
        metricInstance = new Gauge({
          name: metric.name,
          help: metric.help,
          labelNames: metric.labelNames
        });
        break;
      case 'histogram':
        metricInstance = new Histogram({
          name: metric.name,
          help: metric.help,
          labelNames: metric.labelNames
        });
        break;
      case 'summary':
        metricInstance = new Summary({
          name: metric.name,
          help: metric.help,
          labelNames: metric.labelNames
        });
        break;
    }

    this.metrics.set(metric.name, metricInstance);
  }

  /**
   * Record HTTP request
   */
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    this.httpRequests.labels(method, route, statusCode.toString()).inc();
    this.httpDuration.labels(method, route).observe(duration / 1000); // Convert to seconds
  }

  /**
   * Record Worker invocation
   */
  recordWorkerInvocation(workerName: string, status: 'success' | 'error'): void {
    this.workerInvocations.labels(workerName, status).inc();
  }

  /**
   * Record D1 query
   */
  recordD1Query(database: string, operation: string, status: 'success' | 'error'): void {
    this.d1Queries.labels(database, operation, status).inc();
  }

  /**
   * Record R2 operation
   */
  recordR2Operation(bucket: string, operation: string, status: 'success' | 'error'): void {
    this.r2Operations.labels(bucket, operation, status).inc();
  }

  /**
   * Record KV operation
   */
  recordKVOperation(namespace: string, operation: string, status: 'success' | 'error'): void {
    this.kvOperations.labels(namespace, operation, status).inc();
  }

  /**
   * Record vector search
   */
  recordVectorSearch(index: string, status: 'success' | 'error'): void {
    this.vectorSearches.labels(index, status).inc();
  }

  /**
   * Record AI Gateway request
   */
  recordAIGatewayRequest(provider: string, model: string, status: 'success' | 'error', cost: number): void {
    this.aiGatewayRequests.labels(provider, model, status).inc();
    if (cost > 0) {
      this.aiGatewayCost.labels(provider, model).inc(cost);
    }
  }

  /**
   * Record deployment
   */
  recordDeployment(environment: string, status: 'success' | 'error'): void {
    this.deployments.labels(environment, status).inc();
  }

  /**
   * Record error
   */
  recordError(type: string, severity: 'critical' | 'warning' | 'info'): void {
    this.errors.labels(type, severity).inc();
  }

  /**
   * Update active connections
   */
  updateActiveConnections(count: number): void {
    this.activeConnections.set(count);
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return await register.metrics();
  }

  /**
   * Register all metrics with Prometheus
   */
  private registerMetrics(): void {
    register.registerMetric(this.httpRequests);
    register.registerMetric(this.httpDuration);
    register.registerMetric(this.activeConnections);
    register.registerMetric(this.workerInvocations);
    register.registerMetric(this.d1Queries);
    register.registerMetric(this.r2Operations);
    register.registerMetric(this.kvOperations);
    register.registerMetric(this.vectorSearches);
    register.registerMetric(this.aiGatewayRequests);
    register.registerMetric(this.aiGatewayCost);
    register.registerMetric(this.deployments);
    register.registerMetric(this.errors);
  }

  /**
   * Push metrics to Prometheus Pushgateway
   */
  async pushMetrics(pushgatewayUrl: string, jobName: string = 'zagent'): Promise<void> {
    const metrics = await this.getMetrics();

    const response = await fetch(`${pushgatewayUrl}/metrics/job/${jobName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: metrics
    });

    if (!response.ok) {
      throw new Error(`Failed to push metrics: ${await response.text()}`);
    }
  }
}

// ============================================================================
// GRAFANA SERVICE
// ============================================================================

export class GrafanaService {
  private config: ConfigService;
  private grafanaUrl: string;
  private apiKey: string;

  constructor(configService: ConfigService, grafanaUrl?: string, apiKey?: string) {
    this.config = configService;
    const env = this.config.getConfig().originalEnv;

    this.grafanaUrl = grafanaUrl || env?.GRAFANA_URL || 'http://localhost:3001';
    this.apiKey = apiKey || env?.GRAFANA_API_KEY || '';
  }

  /**
   * Create data source
   */
  async createDataSource(dataSource: GrafanaDataSource): Promise<any> {
    const response = await fetch(`${this.grafanaUrl}/api/datasources`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dataSource)
    });

    if (!response.ok) {
      throw new Error(`Failed to create data source: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Create dashboard
   */
  async createDashboard(dashboard: GrafanaDashboard): Promise<any> {
    const response = await fetch(`${this.grafanaUrl}/api/dashboards/db`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dashboard,
        overwrite: false
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create dashboard: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Get dashboard by UID
   */
  async getDashboard(uid: string): Promise<GrafanaDashboard> {
    const response = await fetch(`${this.grafanaUrl}/api/dashboards/uid/${uid}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get dashboard: ${await response.text()}`);
    }

    const data = await response.json();
    return data.dashboard;
  }

  /**
   * Update dashboard
   */
  async updateDashboard(dashboard: GrafanaDashboard): Promise<any> {
    const response = await fetch(`${this.grafanaUrl}/api/dashboards/db`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dashboard,
        overwrite: true
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to update dashboard: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Delete dashboard
   */
  async deleteDashboard(uid: string): Promise<void> {
    const response = await fetch(`${this.grafanaUrl}/api/dashboards/uid/${uid}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to delete dashboard: ${await response.text()}`);
    }
  }

  /**
   * Create alert rule
   */
  async createAlertRule(rule: AlertRule): Promise<any> {
    const alertRule = {
      title: rule.name,
      ruleGroup: 'zagent-alerts',
      interval: '1m',
      rules: [{
        alert: rule.name,
        expr: rule.expr,
        for: rule.duration,
        labels: {
          severity: rule.severity,
          ...rule.labels
        },
        annotations: rule.annotations
      }]
    };

    const response = await fetch(`${this.grafanaUrl}/api/ruler/grafana/api/v1/rules/zagent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(alertRule)
    });

    if (!response.ok) {
      throw new Error(`Failed to create alert rule: ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Create ZAgent default dashboard
   */
  async createZAgentDashboard(): Promise<any> {
    const dashboard: GrafanaDashboard = {
      title: 'ZAgent Monitoring',
      tags: ['zagent', 'cloudflare', 'monitoring'],
      refresh: '10s',
      time: { from: 'now-1h', to: 'now' },
      panels: [
        {
          id: 1,
          title: 'HTTP Requests per Second',
          type: 'graph',
          targets: [{
            expr: 'rate(zagent_http_requests_total[5m])',
            legendFormat: '{{method}} {{route}}',
            refId: 'A'
          }],
          gridPos: { x: 0, y: 0, w: 12, h: 8 }
        },
        {
          id: 2,
          title: 'Request Duration (p99)',
          type: 'graph',
          targets: [{
            expr: 'histogram_quantile(0.99, rate(zagent_http_request_duration_seconds_bucket[5m]))',
            legendFormat: '{{method}} {{route}}',
            refId: 'A'
          }],
          gridPos: { x: 12, y: 0, w: 12, h: 8 }
        },
        {
          id: 3,
          title: 'Active Connections',
          type: 'stat',
          targets: [{
            expr: 'zagent_active_connections',
            refId: 'A'
          }],
          gridPos: { x: 0, y: 8, w: 6, h: 4 }
        },
        {
          id: 4,
          title: 'Error Rate',
          type: 'stat',
          targets: [{
            expr: 'rate(zagent_errors_total[5m])',
            refId: 'A'
          }],
          gridPos: { x: 6, y: 8, w: 6, h: 4 }
        },
        {
          id: 5,
          title: 'Worker Invocations',
          type: 'graph',
          targets: [{
            expr: 'rate(zagent_worker_invocations_total[5m])',
            legendFormat: '{{worker_name}} - {{status}}',
            refId: 'A'
          }],
          gridPos: { x: 12, y: 8, w: 12, h: 8 }
        },
        {
          id: 6,
          title: 'D1 Queries per Second',
          type: 'graph',
          targets: [{
            expr: 'rate(zagent_d1_queries_total[5m])',
            legendFormat: '{{database}} - {{operation}}',
            refId: 'A'
          }],
          gridPos: { x: 0, y: 16, w: 8, h: 8 }
        },
        {
          id: 7,
          title: 'R2 Operations per Second',
          type: 'graph',
          targets: [{
            expr: 'rate(zagent_r2_operations_total[5m])',
            legendFormat: '{{bucket}} - {{operation}}',
            refId: 'A'
          }],
          gridPos: { x: 8, y: 16, w: 8, h: 8 }
        },
        {
          id: 8,
          title: 'Vector Searches per Second',
          type: 'graph',
          targets: [{
            expr: 'rate(zagent_vector_searches_total[5m])',
            legendFormat: '{{index}}',
            refId: 'A'
          }],
          gridPos: { x: 16, y: 16, w: 8, h: 8 }
        },
        {
          id: 9,
          title: 'AI Gateway Cost (USD)',
          type: 'stat',
          targets: [{
            expr: 'sum(zagent_ai_gateway_cost_usd)',
            refId: 'A'
          }],
          gridPos: { x: 0, y: 24, w: 6, h: 4 }
        },
        {
          id: 10,
          title: 'AI Requests by Provider',
          type: 'graph',
          targets: [{
            expr: 'rate(zagent_ai_gateway_requests_total[5m])',
            legendFormat: '{{provider}} - {{model}}',
            refId: 'A'
          }],
          gridPos: { x: 6, y: 24, w: 18, h: 8 }
        }
      ]
    };

    return await this.createDashboard(dashboard);
  }

  /**
   * Create default alert rules
   */
  async createDefaultAlertRules(): Promise<void> {
    const rules: AlertRule[] = [
      {
        name: 'HighErrorRate',
        expr: 'rate(zagent_errors_total[5m]) > 10',
        duration: '5m',
        severity: 'critical',
        annotations: {
          summary: 'High error rate detected',
          description: 'Error rate is above 10 errors per second for 5 minutes'
        }
      },
      {
        name: 'HighRequestDuration',
        expr: 'histogram_quantile(0.99, rate(zagent_http_request_duration_seconds_bucket[5m])) > 5',
        duration: '5m',
        severity: 'warning',
        annotations: {
          summary: 'High request duration detected',
          description: 'p99 request duration is above 5 seconds'
        }
      },
      {
        name: 'HighAICost',
        expr: 'increase(zagent_ai_gateway_cost_usd[1h]) > 10',
        duration: '1m',
        severity: 'warning',
        annotations: {
          summary: 'High AI Gateway cost',
          description: 'AI Gateway cost exceeded $10 in the last hour'
        }
      },
      {
        name: 'D1QueryFailures',
        expr: 'rate(zagent_d1_queries_total{status="error"}[5m]) > 5',
        duration: '5m',
        severity: 'critical',
        annotations: {
          summary: 'D1 query failures detected',
          description: 'D1 query error rate is above 5 per second'
        }
      }
    ];

    for (const rule of rules) {
      try {
        await this.createAlertRule(rule);
        console.log(`Created alert rule: ${rule.name}`);
      } catch (error) {
        console.error(`Failed to create alert rule ${rule.name}:`, error);
      }
    }
  }

  /**
   * Setup Prometheus data source
   */
  async setupPrometheusDataSource(prometheusUrl: string = 'http://localhost:9090'): Promise<any> {
    const dataSource: GrafanaDataSource = {
      name: 'Prometheus',
      type: 'prometheus',
      url: prometheusUrl,
      access: 'proxy',
      jsonData: {
        httpMethod: 'POST',
        timeInterval: '15s'
      }
    };

    return await this.createDataSource(dataSource);
  }
}

/**
 * Initialize Grafana & Prometheus integration
 */
export async function initializeGrafanaPrometheus(
  configService: ConfigService,
  grafanaUrl?: string,
  grafanaApiKey?: string
): Promise<{ prometheus: PrometheusMetricsService; grafana: GrafanaService }> {
  const prometheus = new PrometheusMetricsService(configService);
  const grafana = new GrafanaService(configService, grafanaUrl, grafanaApiKey);

  // Setup Prometheus data source in Grafana
  try {
    await grafana.setupPrometheusDataSource();
    console.log('✅ Prometheus data source configured in Grafana');
  } catch (error) {
    console.warn('Could not setup Prometheus data source:', error);
  }

  // Create default dashboard
  try {
    await grafana.createZAgentDashboard();
    console.log('✅ ZAgent dashboard created in Grafana');
  } catch (error) {
    console.warn('Could not create ZAgent dashboard:', error);
  }

  // Create default alert rules
  try {
    await grafana.createDefaultAlertRules();
    console.log('✅ Default alert rules created');
  } catch (error) {
    console.warn('Could not create alert rules:', error);
  }

  return { prometheus, grafana };
}
