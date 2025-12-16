import { Context } from 'hono';
import { Counter, Histogram, Registry } from 'prom-client';

export class PrometheusService {
    public register: Registry;
    public httpRequestCounter: Counter<string>;
    public httpRequestDurationHistogram: Histogram<string>;

    constructor() {
        this.register = new Registry();
        this.register.setDefaultLabels({
            app: 'unified-cloudflare-agent'
        });

        this.httpRequestCounter = new Counter({
            name: 'http_requests_total',
            help: 'Total number of HTTP requests',
            labelNames: ['method', 'path', 'status_code'],
            registers: [this.register],
        });

        this.httpRequestDurationHistogram = new Histogram({
            name: 'http_request_duration_seconds',
            help: 'Duration of HTTP requests in seconds',
            labelNames: ['method', 'path'],
            registers: [this.register],
        });
    }

    async getMetrics() {
        return this.register.metrics();
    }
}

export const initializePrometheus = (c: Context, next: () => Promise<void>) => {
    const prometheusService = new PrometheusService();
    c.set('prometheus', prometheusService);
    return next();
};
