/**
 * Monitoring Service for Knowledge Base Operations
 * Implements metrics collection and tracing for observability with Grafana
 */

import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { trace, context, Span, SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export interface MonitoringConfig {
  serviceName: string;
  otlpEndpoint?: string;
  enableDefaultMetrics: boolean;
  enableTracing: boolean;
}

export class MonitoringService {
  private registry: Registry;
  private queryCounter: Counter;
  private queryDurationHistogram: Histogram;
 private errorCounter: Counter;
  private sdk: NodeSDK | null = null;
 private config: MonitoringConfig;

  constructor(config: MonitoringConfig) {
    this.config = config;
    this.registry = new Registry();
    
    // Initialize metrics
    this.queryCounter = new Counter({
      name: 'kb_query_total',
      help: 'Total number of knowledge base queries',
      labelNames: ['type', 'success'],
      registers: [this.registry]
    });

    this.queryDurationHistogram = new Histogram({
      name: 'kb_query_duration_seconds',
      help: 'Duration of knowledge base queries',
      labelNames: ['type'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry]
    });

    this.errorCounter = new Counter({
      name: 'kb_error_total',
      help: 'Total number of knowledge base errors',
      labelNames: ['type', 'error'],
      registers: [this.registry]
    });

    if (config.enableDefaultMetrics) {
      collectDefaultMetrics({ register: this.registry });
    }
  }

  /**
   * Initializes OpenTelemetry tracing
   */
  async initializeTracing(): Promise<void> {
    if (!this.config.enableTracing) {
      return;
    }

    try {
      const traceExporter = new OTLPTraceExporter({
        url: this.config.otlpEndpoint || 'http://localhost:4318/v1/traces'
      });

      this.sdk = new NodeSDK({
        resource: new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName
        }),
        traceExporter,
        instrumentations: [getNodeAutoInstrumentations()]
      });

      await this.sdk.start();
      console.log('OpenTelemetry tracing initialized');
    } catch (error) {
      console.error('Failed to initialize OpenTelemetry tracing:', error);
    }
  }

  /**
   * Records a knowledge base query
   */
  recordQuery(type: string, success: boolean): void {
    this.queryCounter.inc({ type, success: success.toString() });
  }

  /**
   * Records the duration of a knowledge base query
   */
  recordQueryDuration(type: string, duration: number): void {
    this.queryDurationHistogram.observe({ type }, duration);
  }

  /**
   * Records a knowledge base error
   */
  recordError(type: string, error: string): void {
    this.errorCounter.inc({ type, error });
  }

  /**
   * Starts a trace span for a knowledge base operation
   */
  async traceOperation<T>(operationName: string, fn: () => Promise<T>): Promise<T> {
    if (!this.config.enableTracing) {
      return fn();
    }

    const tracer = trace.getTracer(this.config.serviceName);
    return tracer.startActiveSpan(operationName, async (span: Span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    });
 }

  /**
   * Gets the Prometheus metrics registry
   */
  getMetricsRegistry(): Registry {
    return this.registry;
  }

  /**
   * Gets the current metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return await this.registry.metrics();
  }

  /**
   * Shuts down the monitoring service
   */
  async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown();
    }
 }
}

/**
 * Enhanced monitoring for knowledge base operations
 */
export class KnowledgeBaseMonitoringService extends MonitoringService {
  /**
   * Records a document embedding operation
   */
  recordEmbeddingOperation(success: boolean, duration: number): void {
    this.recordQuery('embedding', success);
    this.recordQueryDuration('embedding', duration);
  }

  /**
   * Records a knowledge base search operation
   */
  recordSearchOperation(success: boolean, duration: number, resultsCount: number): void {
    this.recordQuery('search', success);
    this.recordQueryDuration('search', duration);
    
    // Additional metric for search results
    if (resultsCount > 0) {
      this.recordQuery('search_with_results', success);
    }
  }

  /**
   * Records a knowledge base update operation
   */
  recordUpdateOperation(success: boolean, duration: number): void {
    this.recordQuery('update', success);
    this.recordQueryDuration('update', duration);
  }

  /**
   * Records a knowledge base retrieval operation
   */
  recordRetrievalOperation(success: boolean, duration: number): void {
    this.recordQuery('retrieval', success);
    this.recordQueryDuration('retrieval', duration);
  }

  /**
   * Traces an embedding operation
   */
  async traceEmbeddingOperation<T>(fn: () => Promise<T>): Promise<T> {
    return this.traceOperation('kb.embedding', fn);
  }

  /**
   * Traces a search operation
   */
  async traceSearchOperation<T>(fn: () => Promise<T>): Promise<T> {
    return this.traceOperation('kb.search', fn);
  }

  /**
   * Traces an update operation
   */
  async traceUpdateOperation<T>(fn: () => Promise<T>): Promise<T> {
    return this.traceOperation('kb.update', fn);
  }

  /**
   * Traces a retrieval operation
   */
  async traceRetrievalOperation<T>(fn: () => Promise<T>): Promise<T> {
    return this.traceOperation('kb.retrieval', fn);
  }
}

/**
 * Metrics middleware for Hono
 */
export const metricsMiddleware = async (c: any, next: () => Promise<void>) => {
  const monitoringService = c.get('monitoringService');
  if (!monitoringService) {
    await next();
    return;
  }

  const start = Date.now();
  try {
    await next();
    const duration = (Date.now() - start) / 1000; // Convert to seconds
    
    // Record successful request
    monitoringService.recordQuery('api', true);
    monitoringService.recordQueryDuration('api', duration);
  } catch (error) {
    const duration = (Date.now() - start) / 1000; // Convert to seconds
    
    // Record error
    monitoringService.recordQuery('api', false);
    monitoringService.recordQueryDuration('api', duration);
    monitoringService.recordError('api', (error as Error).message);
    
    throw error;
  }
};

/**
 * Initialize monitoring service
 */
export const initializeMonitoring = async (c: any, next: () => Promise<void>) => {
  const monitoringConfig = {
    serviceName: c.env?.MONITORING_SERVICE_NAME || process.env.MONITORING_SERVICE_NAME || 'zagent-kb',
    otlpEndpoint: c.env?.OTLP_ENDPOINT || process.env.OTLP_ENDPOINT,
    enableDefaultMetrics: c.env?.ENABLE_DEFAULT_METRICS !== 'false' && process.env.ENABLE_DEFAULT_METRICS !== 'false',
    enableTracing: c.env?.ENABLE_TRACING !== 'false' && process.env.ENABLE_TRACING !== 'false'
  };

  const monitoringService = new KnowledgeBaseMonitoringService(monitoringConfig);
  await monitoringService.initializeTracing();
  
  c.set('monitoringService', monitoringService);
  await next();
};