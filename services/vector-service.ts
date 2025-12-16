import { Context } from 'hono';
import { D1Service } from './d1-service';

interface Vector {
    id: string;
    embedding: number[];
    metadata: Record<string, any>;
    created_at: string;
    updated_at: string;
}

interface VectorQueryResult {
    vector: Vector;
    score: number;
}

export class VectorService {
    private d1Service: D1Service;
    private tableName: string;

    constructor(d1Service: D1Service, tableName: string = 'vectors') {
        this.d1Service = d1Service;
        this.tableName = tableName;
        this.initializeTable();
    }

    private async initializeTable(): Promise<void> {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                id TEXT PRIMARY KEY,
                embedding TEXT NOT NULL, -- JSON array of numbers
                metadata TEXT NOT NULL, -- JSON object
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_vectors_metadata ON ${this.tableName}(metadata);
            CREATE INDEX IF NOT EXISTS idx_vectors_created_at ON ${this.tableName}(created_at);
        `;

        await this.d1Service.execute(createTableSQL);
    }

    async upsert(vectors: Omit<Vector, 'created_at' | 'updated_at'>[]): Promise<void> {
        const now = new Date().toISOString();

        for (const vec of vectors) {
            const existing = await this.getById(vec.id);

            if (existing) {
                // Update existing vector
                const updateSQL = `
                    UPDATE ${this.tableName}
                    SET embedding = ?, metadata = ?, updated_at = ?
                    WHERE id = ?
                `;
                await this.d1Service.execute(updateSQL, [
                    JSON.stringify(vec.embedding),
                    JSON.stringify(vec.metadata),
                    now,
                    vec.id
                ]);
            } else {
                // Insert new vector
                const insertSQL = `
                    INSERT INTO ${this.tableName} (id, embedding, metadata, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                `;
                await this.d1Service.execute(insertSQL, [
                    vec.id,
                    JSON.stringify(vec.embedding),
                    JSON.stringify(vec.metadata),
                    now,
                    now
                ]);
            }
        }
    }

    async query(embedding: number[], topK: number = 5, filter?: Record<string, any>): Promise<VectorQueryResult[]> {
        // Get all vectors (in production, you'd want to optimize this with indexing)
        const selectSQL = `SELECT * FROM ${this.tableName}`;
        const result = await this.d1Service.query(selectSQL);

        if (!result.success || !result.result) {
            return [];
        }

        const vectors: Vector[] = result.result.map((row: any) => ({
            id: row.id as string,
            embedding: JSON.parse(row.embedding as string),
            metadata: JSON.parse(row.metadata as string),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string
        }));

        // Filter vectors if filter is provided
        let filteredVectors = vectors;
        if (filter) {
            filteredVectors = vectors.filter(vec => {
                return Object.entries(filter).every(([key, value]) => {
                    return vec.metadata[key] === value;
                });
            });
        }

        // Calculate similarities
        const scores: VectorQueryResult[] = filteredVectors.map(vec => ({
            vector: vec,
            score: this.cosineSimilarity(embedding, vec.embedding),
        }));

        // Sort by score descending and return top K
        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, topK);
    }

    async getById(id: string): Promise<Vector | null> {
        const selectSQL = `SELECT * FROM ${this.tableName} WHERE id = ?`;
        const result = await this.d1Service.query(selectSQL, [id]);

        if (!result.success || !result.result || result.result.length === 0) {
            return null;
        }

        const row = result.result[0];
        return {
            id: row.id as string,
            embedding: JSON.parse(row.embedding as string),
            metadata: JSON.parse(row.metadata as string),
            created_at: row.created_at as string,
            updated_at: row.updated_at as string
        };
    }

    async delete(id: string): Promise<boolean> {
        const deleteSQL = `DELETE FROM ${this.tableName} WHERE id = ?`;
        const result = await this.d1Service.execute(deleteSQL, [id]);
        return result.success && result.meta?.rows_written > 0;
    }

    async count(): Promise<number> {
        const countSQL = `SELECT COUNT(*) as count FROM ${this.tableName}`;
        const result = await this.d1Service.query(countSQL);

        if (!result.success || !result.result || result.result.length === 0) {
            return 0;
        }

        return result.result[0].count as number;
    }

    async clear(): Promise<void> {
        const clearSQL = `DELETE FROM ${this.tableName}`;
        await this.d1Service.execute(clearSQL);
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            return 0;
        }
        const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
        const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        if (magA === 0 || magB === 0) {
            return 0;
        }
        return dotProduct / (magA * magB);
    }
}

export const initializeVectorService = async (c: Context, next: () => Promise<void>) => {
    const d1Service = c.get('d1Service');
    if (!d1Service) {
        throw new Error('D1Service not initialized');
    }

    const service = new VectorService(d1Service);
    c.set('vectorService', service);
    await next();
};
