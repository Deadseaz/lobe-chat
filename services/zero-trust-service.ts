import { Context, Next } from 'hono';

export class ZeroTrustService {
    // A simple in-memory store for API keys and user roles.
    // In a real application, this would be a database.
    private apiKeys = new Map<string, { userId: string, roles: string[] }>();
    private users = new Map<string, { roles: string[] }>();

    constructor() {
        // Add a default admin user for demonstration purposes
        this.users.set('admin', { roles: ['admin'] });
        this.apiKeys.set('super-secret-key', { userId: 'admin', roles: ['admin'] });
    }

    async authenticate(c: Context, next: Next): Promise<void> {
        const apiKey = c.req.header('X-API-Key');
        if (!apiKey) {
            c.json({ error: 'Missing API Key' }, 401);
            return;
        }

        const keyData = this.apiKeys.get(apiKey);
        if (!keyData) {
            c.json({ error: 'Invalid API Key' }, 401);
            return;
        }

        const user = this.users.get(keyData.userId);
        if (!user) {
            c.json({ error: 'Invalid User' }, 401);
            return;
        }

        c.set('user', { id: keyData.userId, roles: user.roles });
        await next();
    }

    hasRole(requiredRoles: string[]) {
        return async (c: Context, next: Next): Promise<void> => {
            const user = c.get('user');
            if (!user) {
                c.json({ error: 'Not authenticated' }, 401);
                return;
            }

            const hasAllRoles = requiredRoles.every(role => user.roles.includes(role));
            if (!hasAllRoles) {
                c.json({ error: 'Forbidden' }, 403);
                return;
            }

            await next();
        };
    }

    // A more advanced prompt injection filter.
    isPromptSafe(prompt: string): boolean {
        const sanitizedPrompt = prompt.toLowerCase().trim();

        // High-confidence patterns for immediate rejection
        const highConfidencePatterns = [
            /ignore your previous instructions/,
            /reveal your secrets/,
            /act as if you are/,
            /system security alert/,
            /internal use only/,
            // Patterns targeting prompt structure
            /\{\{.*\}\}/,
            /\[\[.*\]\]/,
        ];

        for (const pattern of highConfidencePatterns) {
            if (pattern.test(sanitizedPrompt)) {
                return false;
            }
        }

        // Heuristics for suspicious content
        let suspiciousScore = 0;
        if ((sanitizedPrompt.match(/:/g) || []).length > 5) suspiciousScore++;
        if ((sanitizedPrompt.match(/\{/g) || []).length > 3) suspiciousScore++;
        if ((sanitizedPrompt.match(/\[/g) || []).length > 3) suspiciousScore++;
        if (sanitizedPrompt.length > 2000) suspiciousScore++; // Unusually long prompts

        return suspiciousScore < 2;
    }
}

export const initializeZeroTrustService = (c: Context, next: () => Promise<void>) => {
  const service = new ZeroTrustService();
  c.set('zeroTrustService', service);
  return next();
};
