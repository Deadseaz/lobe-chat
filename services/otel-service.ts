import { Context, Next } from 'hono';

export interface TelemetryData {
  timestamp: number;
  service: string;
  operation: string;
  duration?: number;
  status?: 'success' | 'error';
  error?: string;
  metadata?: Record<string, any>;
}

export class OpenTelemetryService {
  private traces: TelemetryData[] = [];
  private metrics: Record<string, number> = {};
  private maxTraces = 1000;

  constructor() {
    // Initialize basic metrics
    this.metrics = {
      totalRequests: 0,
      errorCount: 0,
      avgResponseTime: 0,
      uptime: Date.now()
    };
  }

  // Record a trace
  recordTrace(data: Omit<TelemetryData, 'timestamp'>): void {
    const trace: TelemetryData = {
      ...data,
      timestamp: Date.now()
    };

    this.traces.push(trace);

    // Keep only recent traces
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-this.maxTraces);
    }

    // Update metrics
    this.metrics['totalRequests'] = (this.metrics['totalRequests'] || 0) + 1;
    if (data.status === 'error') {
      this.metrics['errorCount'] = (this.metrics['errorCount'] || 0) + 1;
    }
    if (data.duration) {
      const currentAvg = this.metrics['avgResponseTime'] || 0;
      const totalRequests = this.metrics['totalRequests'] || 1;
      this.metrics['avgResponseTime'] = (currentAvg * (totalRequests - 1) + data.duration) / totalRequests;
    }
  }

  // Increment a metric
  incrementMetric(name: string, value: number = 1): void {
    this.metrics[name] = (this.metrics[name] ?? 0) + value;
  }

  // Set a metric value
  setMetric(name: string, value: number): void {
    this.metrics[name] = value;
  }

  // Get current metrics
  getMetrics(): Record<string, number> {
    return { ...this.metrics };
  }

  // Get recent traces
  getTraces(limit: number = 100): TelemetryData[] {
    return this.traces.slice(-limit);
  }

  // Export traces in OTLP format (simplified)
  exportTraces(): any {
    return {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'cloudflare-agent' } },
            { key: 'service.version', value: { stringValue: '1.0.0' } }
          ]
        },
        scopeSpans: [{
          spans: this.traces.map(trace => ({
            traceId: this.generateTraceId(),
            spanId: this.generateSpanId(),
            name: trace.operation,
            startTimeUnixNano: trace.timestamp * 1000000,
            endTimeUnixNano: (trace.timestamp + (trace.duration || 0)) * 1000000,
            attributes: [
              { key: 'status', value: { stringValue: trace.status || 'unknown' } },
              ...(trace.error ? [{ key: 'error', value: { stringValue: trace.error } }] : []),
              ...Object.entries(trace.metadata || {}).map(([k, v]) => ({
                key: k,
                value: { stringValue: String(v) }
              }))
            ]
          }))
        }]
      }]
    };
  }

  // Export metrics in OTLP format (simplified)
  exportMetrics(): any {
    return {
      resourceMetrics: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'cloudflare-agent' } }
          ]
        },
        scopeMetrics: [{
          metrics: Object.entries(this.metrics).map(([name, value]) => ({
            name,
            data: {
              gauge: {
                dataPoints: [{
                  timeUnixNano: Date.now() * 1000000,
                  value
                }]
              }
            }
          }))
        }]
      }]
    };
  }

  private generateTraceId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private generateSpanId(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}

// Middleware for Hono to automatically record traces
export function telemetryMiddleware(otelService: OpenTelemetryService) {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    const operation = `${c.req.method} ${c.req.path}`;

    try {
      await next();

      const duration = Date.now() - startTime;
      const status = c.res.status >= 400 ? 'error' : 'success';

      otelService.recordTrace({
        service: 'cloudflare-agent',
        operation,
        duration,
        status,
        metadata: {
          statusCode: c.res.status,
          userAgent: c.req.header('User-Agent'),
          ip: c.req.header('CF-Connecting-IP')
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      otelService.recordTrace({
        service: 'cloudflare-agent',
        operation,
        duration,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          userAgent: c.req.header('User-Agent'),
          ip: c.req.header('CF-Connecting-IP')
        }
      });

      throw error;
    }
  };
}

// Singleton instance
export const otelService = new OpenTelemetryService();
