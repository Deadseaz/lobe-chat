import { Context } from 'hono';
import { D1Service } from './d1-service';

export interface ExtensionManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    category?: string;
    tags?: string[];
    downloadUrl: string;
    repositoryUrl?: string;
    license?: string;
    rating?: number;
    downloads?: number;
    compatibleVersions?: string[];
    dependencies?: string[];
    created_at: string;
    updated_at: string;
}

export interface ExtensionSearchQuery {
    query?: string;
    category?: string;
    author?: string;
    compatibleVersion?: string;
    limit?: number;
    offset?: number;
}

export class ExtensionMarketplaceService {
    private d1Service: D1Service;
    private tableName: string;

    constructor(d1Service: D1Service, tableName: string = 'extensions') {
        this.d1Service = d1Service;
        this.tableName = tableName;
        this.initializeTable();
    }

    private async initializeTable(): Promise<void> {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                description TEXT NOT NULL,
                author TEXT NOT NULL,
                category TEXT,
                tags TEXT, -- JSON array
                download_url TEXT NOT NULL,
                repository_url TEXT,
                license TEXT,
                rating REAL DEFAULT 0,
                downloads INTEGER DEFAULT 0,
                compatible_versions TEXT, -- JSON array
                dependencies TEXT, -- JSON array
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_extensions_category ON ${this.tableName}(category);
            CREATE INDEX IF NOT EXISTS idx_extensions_author ON ${this.tableName}(author);
            CREATE INDEX IF NOT EXISTS idx_extensions_rating ON ${this.tableName}(rating DESC);
            CREATE INDEX IF NOT EXISTS idx_extensions_downloads ON ${this.tableName}(downloads DESC);
        `;

        await this.d1Service.execute(createTableSQL);
    }

    async listExtensions(query?: ExtensionSearchQuery): Promise<ExtensionManifest[]> {
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

            if (query.author) {
                conditions.push(`author = ?`);
                params.push(query.author);
            }

            if (query.compatibleVersion) {
                conditions.push(`compatible_versions LIKE ?`);
                params.push(`%${query.compatibleVersion}%`);
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
            version: row.version,
            description: row.description,
            author: row.author,
            category: row.category,
            tags: row.tags ? JSON.parse(row.tags) : [],
            downloadUrl: row.download_url,
            repositoryUrl: row.repository_url,
            license: row.license,
            rating: row.rating,
            downloads: row.downloads,
            compatibleVersions: row.compatible_versions ? JSON.parse(row.compatible_versions) : [],
            dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
            created_at: row.created_at,
            updated_at: row.updated_at
        }));
    }

    async getExtension(id: string): Promise<ExtensionManifest | null> {
        const sql = `SELECT * FROM ${this.tableName} WHERE id = ?`;
        const result = await this.d1Service.query(sql, [id]);

        if (!result.success || !result.result || result.result.length === 0) {
            return null;
        }

        const row = result.result[0];
        return {
            id: row.id,
            name: row.name,
            version: row.version,
            description: row.description,
            author: row.author,
            category: row.category,
            tags: row.tags ? JSON.parse(row.tags) : [],
            downloadUrl: row.download_url,
            repositoryUrl: row.repository_url,
            license: row.license,
            rating: row.rating,
            downloads: row.downloads,
            compatibleVersions: row.compatible_versions ? JSON.parse(row.compatible_versions) : [],
            dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
            created_at: row.created_at,
            updated_at: row.updated_at
        };
    }

    async registerExtension(manifest: Omit<ExtensionManifest, 'created_at' | 'updated_at'>): Promise<ExtensionManifest> {
        // Check if extension already exists
        const existing = await this.getExtension(manifest.id);
        if (existing) {
            throw new Error(`Extension with ID ${manifest.id} already exists.`);
        }

        const now = new Date().toISOString();
        const sql = `
            INSERT INTO ${this.tableName}
            (id, name, version, description, author, category, tags, download_url, repository_url, license, rating, downloads, compatible_versions, dependencies, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            manifest.id,
            manifest.name,
            manifest.version,
            manifest.description,
            manifest.author,
            manifest.category || null,
            manifest.tags ? JSON.stringify(manifest.tags) : null,
            manifest.downloadUrl,
            manifest.repositoryUrl || null,
            manifest.license || null,
            manifest.rating || 0,
            manifest.downloads || 0,
            manifest.compatibleVersions ? JSON.stringify(manifest.compatibleVersions) : null,
            manifest.dependencies ? JSON.stringify(manifest.dependencies) : null,
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

    async updateExtension(id: string, updates: Partial<Omit<ExtensionManifest, 'id' | 'created_at' | 'updated_at'>>): Promise<ExtensionManifest | null> {
        const existing = await this.getExtension(id);
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
        if (updates.version !== undefined) {
            updateFields.push('version = ?');
            params.push(updates.version);
        }
        if (updates.description !== undefined) {
            updateFields.push('description = ?');
            params.push(updates.description);
        }
        if (updates.author !== undefined) {
            updateFields.push('author = ?');
            params.push(updates.author);
        }
        if (updates.category !== undefined) {
            updateFields.push('category = ?');
            params.push(updates.category);
        }
        if (updates.tags !== undefined) {
            updateFields.push('tags = ?');
            params.push(JSON.stringify(updates.tags));
        }
        if (updates.downloadUrl !== undefined) {
            updateFields.push('download_url = ?');
            params.push(updates.downloadUrl);
        }
        if (updates.repositoryUrl !== undefined) {
            updateFields.push('repository_url = ?');
            params.push(updates.repositoryUrl);
        }
        if (updates.license !== undefined) {
            updateFields.push('license = ?');
            params.push(updates.license);
        }
        if (updates.rating !== undefined) {
            updateFields.push('rating = ?');
            params.push(updates.rating);
        }
        if (updates.downloads !== undefined) {
            updateFields.push('downloads = ?');
            params.push(updates.downloads);
        }
        if (updates.compatibleVersions !== undefined) {
            updateFields.push('compatible_versions = ?');
            params.push(JSON.stringify(updates.compatibleVersions));
        }
        if (updates.dependencies !== undefined) {
            updateFields.push('dependencies = ?');
            params.push(JSON.stringify(updates.dependencies));
        }

        if (updateFields.length === 0) {
            return existing;
        }

        updateFields.push('updated_at = ?');
        params.push(now);
        params.push(id);

        const sql = `UPDATE ${this.tableName} SET ${updateFields.join(', ')} WHERE id = ?`;
        await this.d1Service.execute(sql, params);

        return this.getExtension(id);
    }

    async incrementDownloads(id: string): Promise<boolean> {
        const sql = `UPDATE ${this.tableName} SET downloads = downloads + 1, updated_at = ? WHERE id = ?`;
        const result = await this.d1Service.execute(sql, [new Date().toISOString(), id]);
        return result.success && result.meta?.rows_written > 0;
    }

    async deleteExtension(id: string): Promise<boolean> {
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

    async getStats(): Promise<{ totalExtensions: number; totalDownloads: number; averageRating: number }> {
        const sql = `
            SELECT
                COUNT(*) as total_extensions,
                SUM(downloads) as total_downloads,
                AVG(rating) as average_rating
            FROM ${this.tableName}
        `;
        const result = await this.d1Service.query(sql);

        if (!result.success || !result.result || result.result.length === 0) {
            return { totalExtensions: 0, totalDownloads: 0, averageRating: 0 };
        }

        const row = result.result[0];
        return {
            totalExtensions: row.total_extensions || 0,
            totalDownloads: row.total_downloads || 0,
            averageRating: row.average_rating || 0
        };
    }

    // Legacy methods for compatibility with existing extension system
    async enableExtension(id: string): Promise<boolean> {
        // This would need integration with the actual extension system
        // For now, just return true
        console.log(`Extension ${id} enabled`);
        return true;
    }

    async disableExtension(id: string): Promise<boolean> {
        // This would need integration with the actual extension system
        // For now, just return true
        console.log(`Extension ${id} disabled`);
        return true;
    }

    async executeExtensionFunction(extensionId: string, functionName: string, ...args: any[]): Promise<any> {
        // This would need integration with the actual extension system
        // For now, throw an error
        console.log(`Executing ${functionName} on extension ${extensionId} with args:`, args);
        throw new Error('Extension execution not implemented in marketplace service');
    }
}

export const initializeExtensionMarketplaceService = async (c: Context, next: () => Promise<void>) => {
    const d1Service = c.get('d1Service');
    if (!d1Service) {
        throw new Error('D1Service not initialized');
    }

    const service = new ExtensionMarketplaceService(d1Service);
    c.set('extensionMarketplace', service);
    await next();
};
