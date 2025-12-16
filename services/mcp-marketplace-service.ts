import { Context } from 'hono';
import { D1Service } from './d1-service';

export interface McpServiceManifest {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    protocol: 'stdio' | 'sse';
    downloadUrl: string;
    category?: string;
    tags?: string[];
    rating?: number;
    downloads?: number;
    created_at: string;
    updated_at: string;
}

export interface McpServiceSearchQuery {
    query?: string;
    category?: string;
    protocol?: 'stdio' | 'sse';
    author?: string;
    limit?: number;
    offset?: number;
}

export class McpMarketplaceService {
    private d1Service: D1Service;
    private tableName: string;

    constructor(d1Service: D1Service, tableName: string = 'mcp_services') {
        this.d1Service = d1Service;
        this.tableName = tableName;
        this.initializeTable();
    }

    private async initializeTable(): Promise<void> {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                version TEXT NOT NULL,
                author TEXT NOT NULL,
                protocol TEXT NOT NULL CHECK (protocol IN ('stdio', 'sse')),
                download_url TEXT NOT NULL,
                category TEXT,
                tags TEXT, -- JSON array
                rating REAL DEFAULT 0,
                downloads INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_mcp_services_category ON ${this.tableName}(category);
            CREATE INDEX IF NOT EXISTS idx_mcp_services_author ON ${this.tableName}(author);
            CREATE INDEX IF NOT EXISTS idx_mcp_services_protocol ON ${this.tableName}(protocol);
            CREATE INDEX IF NOT EXISTS idx_mcp_services_rating ON ${this.tableName}(rating DESC);
            CREATE INDEX IF NOT EXISTS idx_mcp_services_downloads ON ${this.tableName}(downloads DESC);
        `;

        await this.d1Service.execute(createTableSQL);
    }

    async listServices(query?: McpServiceSearchQuery): Promise<McpServiceManifest[]> {
        let sql = `SELECT * FROM ${this.tableName}`;
        const params: any[] = [];
        const conditions: string[] = [];

        if (query) {
            if (query.query) {
                conditions.push(`(name LIKE ? OR description LIKE ? OR tags LIKE ?)`);
                const searchTerm = `%${query.query}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }

            if (query.category) {
                conditions.push(`category = ?`);
                params.push(query.category);
            }

            if (query.protocol) {
                conditions.push(`protocol = ?`);
                params.push(query.protocol);
            }

            if (query.author) {
                conditions.push(`author = ?`);
                params.push(query.author);
            }
        }

        if (conditions.length > 0) {
            sql += ` WHERE ${conditions.join(' AND ')}`;
        }

        sql += ` ORDER BY rating DESC, downloads DESC`;

        if (query?.limit) {
            sql += ` LIMIT ?`;
            params.push(query.limit);
        }

        if (query?.offset) {
            sql += ` OFFSET ?`;
            params.push(query.offset);
        }

        const result = await this.d1Service.query(sql, params);

        if (!result.success || !result.result) {
            return [];
        }

        return result.result.map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            version: row.version,
            author: row.author,
            protocol: row.protocol,
            downloadUrl: row.download_url,
            category: row.category,
            tags: row.tags ? JSON.parse(row.tags) : [],
            rating: row.rating,
            downloads: row.downloads,
            created_at: row.created_at,
            updated_at: row.updated_at
        }));
    }

    async getService(id: string): Promise<McpServiceManifest | null> {
        const sql = `SELECT * FROM ${this.tableName} WHERE id = ?`;
        const result = await this.d1Service.query(sql, [id]);

        if (!result.success || !result.result || result.result.length === 0) {
            return null;
        }

        const row = result.result[0];
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            version: row.version,
            author: row.author,
            protocol: row.protocol,
            downloadUrl: row.download_url,
            category: row.category,
            tags: row.tags ? JSON.parse(row.tags) : [],
            rating: row.rating,
            downloads: row.downloads,
            created_at: row.created_at,
            updated_at: row.updated_at
        };
    }

    async registerService(manifest: Omit<McpServiceManifest, 'created_at' | 'updated_at'>): Promise<McpServiceManifest> {
        // Check if service already exists
        const existing = await this.getService(manifest.id);
        if (existing) {
            throw new Error(`Service with ID ${manifest.id} already exists.`);
        }

        const now = new Date().toISOString();
        const sql = `
            INSERT INTO ${this.tableName}
            (id, name, description, version, author, protocol, download_url, category, tags, rating, downloads, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            manifest.id,
            manifest.name,
            manifest.description,
            manifest.version,
            manifest.author,
            manifest.protocol,
            manifest.downloadUrl,
            manifest.category || null,
            manifest.tags ? JSON.stringify(manifest.tags) : null,
            manifest.rating || 0,
            manifest.downloads || 0,
            now,
            now
        ];

        await this.d1Service.execute(sql, params);

        return {
            ...manifest,
            created_at: now,
            updated_at: now
        };
    }

    async updateService(id: string, updates: Partial<Omit<McpServiceManifest, 'id' | 'created_at' | 'updated_at'>>): Promise<McpServiceManifest | null> {
        const existing = await this.getService(id);
        if (!existing) {
            return null;
        }

        const now = new Date().toISOString();
        const updateFields: string[] = [];
        const params: any[] = [];

        if (updates.name !== undefined) {
            updateFields.push('name = ?');
            params.push(updates.name);
        }
        if (updates.description !== undefined) {
            updateFields.push('description = ?');
            params.push(updates.description);
        }
        if (updates.version !== undefined) {
            updateFields.push('version = ?');
            params.push(updates.version);
        }
        if (updates.author !== undefined) {
            updateFields.push('author = ?');
            params.push(updates.author);
        }
        if (updates.protocol !== undefined) {
            updateFields.push('protocol = ?');
            params.push(updates.protocol);
        }
        if (updates.downloadUrl !== undefined) {
            updateFields.push('download_url = ?');
            params.push(updates.downloadUrl);
        }
        if (updates.category !== undefined) {
            updateFields.push('category = ?');
            params.push(updates.category);
        }
        if (updates.tags !== undefined) {
            updateFields.push('tags = ?');
            params.push(JSON.stringify(updates.tags));
        }
        if (updates.rating !== undefined) {
            updateFields.push('rating = ?');
            params.push(updates.rating);
        }
        if (updates.downloads !== undefined) {
            updateFields.push('downloads = ?');
            params.push(updates.downloads);
        }

        if (updateFields.length === 0) {
            return existing;
        }

        updateFields.push('updated_at = ?');
        params.push(now);
        params.push(id);

        const sql = `UPDATE ${this.tableName} SET ${updateFields.join(', ')} WHERE id = ?`;
        await this.d1Service.execute(sql, params);

        return this.getService(id);
    }

    async incrementDownloads(id: string): Promise<boolean> {
        const sql = `UPDATE ${this.tableName} SET downloads = downloads + 1, updated_at = ? WHERE id = ?`;
        const result = await this.d1Service.execute(sql, [new Date().toISOString(), id]);
        return result.success && result.meta?.rows_written > 0;
    }

    async deleteService(id: string): Promise<boolean> {
        const sql = `DELETE FROM ${this.tableName} WHERE id = ?`;
        const result = await this.d1Service.execute(sql, [id]);
        return result.success && result.meta?.rows_written > 0;
    }

    async getCategories(): Promise<string[]> {
        const sql = `SELECT DISTINCT category FROM ${this.tableName} WHERE category IS NOT NULL ORDER BY category`;
        const result = await this.d1Service.query(sql);

        if (!result.success || !result.result) {
            return [];
        }

        return result.result.map((row: any) => row.category);
    }

    async getStats(): Promise<{ totalServices: number; totalDownloads: number; averageRating: number }> {
        const sql = `
            SELECT
                COUNT(*) as total_services,
                SUM(downloads) as total_downloads,
                AVG(rating) as average_rating
            FROM ${this.tableName}
        `;
        const result = await this.d1Service.query(sql);

        if (!result.success || !result.result || result.result.length === 0) {
            return { totalServices: 0, totalDownloads: 0, averageRating: 0 };
        }

        const row = result.result[0];
        return {
            totalServices: row.total_services || 0,
            totalDownloads: row.total_downloads || 0,
            averageRating: row.average_rating || 0
        };
    }
}

export const initializeMcpMarketplaceService = async (c: Context, next: () => Promise<void>) => {
    const d1Service = c.get('d1Service');
    if (!d1Service) {
        throw new Error('D1Service not initialized');
    }

    const service = new McpMarketplaceService(d1Service);
    c.set('mcpMarketplace', service);
    await next();
};
