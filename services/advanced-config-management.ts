/**
 * Advanced Configuration Management System for zagent
 * Provides comprehensive configuration management with versioning, validation, and synchronization
 */

import { Context } from "hono";
import { AIGuardrailsService } from "../shared/middleware.js";
import { ConfigService } from "../shared/config.js";

export interface ConfigProperty {
  key: string;
  value: any;
  type: "string" | "number" | "boolean" | "object" | "array" | "json";
  defaultValue?: any;
  description?: string;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    allowedValues?: any[];
    required?: boolean;
  };
  sensitive: boolean; // Whether the value is sensitive (like API keys)
  encrypted: boolean; // Whether the value should be encrypted at rest
  tags?: string[];
  lastModified: Date;
  modifiedBy: string;
  version: number;
  environment?: string; // Specific environment this applies to
  category?: string; // Category for organization (e.g., 'ai', 'security', 'integrations')
}

export interface ConfigVersion {
  id: string;
  configId: string;
  value: any;
  version: number;
  timestamp: Date;
  author: string;
  changeDescription: string;
  rollbackAllowed: boolean;
}

export interface ConfigSchema {
  id: string;
  name: string;
  description: string;
  version: number;
  properties: Array<{
    key: string;
    type: string;
    required: boolean;
    defaultValue?: any;
    validation?: any;
    description?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigEnvironment {
  id: string;
  name: string;
  description: string;
  parentEnvironment?: string; // For hierarchical environments (dev -> staging -> prod)
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigSyncStatus {
  source: string;
  target: string;
  lastSync: Date;
  status: "success" | "failed" | "in-progress" | "pending";
  error?: string;
}

export interface ConfigAuditLog {
  id: string;
  action: "create" | "update" | "delete" | "read" | "sync" | "validate";
  key: string;
  oldValue?: any;
  newValue?: any;
  timestamp: Date;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  environment: string;
  result: "success" | "failed";
  details?: string;
}

export class AdvancedConfigManagementService {
  private configStore: Map<string, ConfigProperty> = new Map();
  private configVersions: Map<string, ConfigVersion[]> = new Map(); // key -> versions[]
  private configSchemas: Map<string, ConfigSchema> = new Map();
  private configEnvironments: Map<string, ConfigEnvironment> = new Map();
  private configSyncStatus: Map<string, ConfigSyncStatus> = new Map();
  private auditLogs: ConfigAuditLog[] = [];
  private aiGuardrails: AIGuardrailsService;
  private configService: ConfigService;
  private encryptionKey: string;
  private autoValidation: boolean;
  private versionRetentionCount: number;
  private validationRules: Map<
    string,
    (value: any) => boolean | Promise<boolean>
  > = new Map();

  constructor(aiGuardrails: AIGuardrailsService, configService: ConfigService) {
    this.aiGuardrails = aiGuardrails;
    this.configService = configService;

    const config = this.configService.getConfig();
    this.encryptionKey =
      config.securitySessionSecret || crypto.randomUUID?.() || "fallback-key";
    this.autoValidation =
      (config.originalEnv?.CONFIG_AUTO_VALIDATE ?? "true") === "true";
    this.versionRetentionCount = parseInt(
      config.originalEnv?.CONFIG_VERSION_RETENTION || "10",
    );

    // Initialize default environments
    this.initializeDefaultEnvironments();

    // Initialize validation rules
    this.initializeValidationRules();

    // Initialize with some default configuration properties
    this.initializeDefaultConfigs();
  }

  private initializeDefaultEnvironments(): void {
    // Create default environments
    this.configEnvironments.set("development", {
      id: "development",
      name: "Development",
      description: "Development environment",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.configEnvironments.set("staging", {
      id: "staging",
      name: "Staging",
      description: "Staging/Pre-production environment",
      parentEnvironment: "development",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.configEnvironments.set("production", {
      id: "production",
      name: "Production",
      description: "Production environment",
      parentEnvironment: "staging",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  private initializeValidationRules(): void {
    // Add common validation rules
    this.validationRules.set("email", (value: any) => {
      if (typeof value !== "string") return false;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(value);
    });

    this.validationRules.set("url", (value: any) => {
      if (typeof value !== "string") return false;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    });

    this.validationRules.set("api-key", (value: any) => {
      if (typeof value !== "string") return false;
      // Basic API key format check (alphanumeric + some special chars)
      return /^[a-zA-Z0-9\-_=]{20,}$/.test(value);
    });

    this.validationRules.set("json", (value: any) => {
      if (typeof value === "string") {
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      }
      // If it's already an object/array, it's valid JSON
      return typeof value === "object";
    });
  }

  private initializeDefaultConfigs(): void {
    // Initialize with some default configuration properties
    this.setConfigProperty({
      key: "cf.account.id",
      value: this.configService.getConfig().cfAccountId || "",
      type: "string",
      description: "Cloudflare Account ID",
      validation: { required: true },
      sensitive: false,
      encrypted: false,
      tags: ["cloudflare", "infrastructure"],
      modifiedBy: "system",
      version: 1,
      category: "infrastructure",
    } as any);

    this.setConfigProperty({
      key: "cf.api.token",
      value: this.configService.getConfig().cfApiToken || "",
      type: "string",
      description: "Cloudflare API Token",
      validation: { required: true },
      sensitive: true,
      encrypted: true,
      tags: ["cloudflare", "security", "api"],
      modifiedBy: "system",
      version: 1,
      category: "security",
    } as any);

    this.setConfigProperty({
      key: "ai.gateway.url",
      value: this.configService.getConfig().cfGatewayUrl || "",
      type: "string",
      description: "AI Gateway URL",
      validation: { required: true },
      sensitive: false,
      encrypted: false,
      tags: ["ai", "gateway"],
      modifiedBy: "system",
      version: 1,
      category: "ai",
    } as any);

    this.setConfigProperty({
      key: "security.jwt.secret",
      value: this.configService.getConfig().securityJwtSecret || "",
      type: "string",
      description: "JWT Secret Key",
      validation: { required: true },
      sensitive: true,
      encrypted: true,
      tags: ["security", "authentication"],
      modifiedBy: "system",
      version: 1,
      category: "security",
    } as any);

    this.setConfigProperty({
      key: "learning.enabled",
      value: this.configService.getConfig().selfHealingEnabled ?? true,
      type: "boolean",
      description: "Enable learning and adaptation features",
      defaultValue: true,
      sensitive: false,
      encrypted: false,
      tags: ["ai", "learning"],
      modifiedBy: "system",
      version: 1,
      category: "ai",
    } as any);
  }

  /**
   * Set a configuration property with validation and versioning
   */
  async setConfigProperty(
    property: Omit<ConfigProperty, "lastModified" | "version"> &
      Partial<Pick<ConfigProperty, "version">>,
  ): Promise<{ success: boolean; error?: string; newVersion?: number }> {
    // Validate the property using AI guardrails
    if (
      property.validation?.required &&
      (property.value === undefined || property.value === null)
    ) {
      return {
        success: false,
        error: `Property ${property.key} is required but value is missing`,
      };
    }

    // Run validation if specified
    if (this.autoValidation) {
      const validationResult = await this.validateConfigValue(
        property.key,
        property.value,
        property.validation,
      );
      if (!validationResult.valid) {
        return { success: false, error: validationResult.error };
      }
    }

    // Check if property already exists to handle versioning
    const existingProperty = this.configStore.get(property.key);
    const newVersion = existingProperty
      ? existingProperty.version + 1
      : property.version || 1;

    // Create new property object with updated timestamps
    const newProperty: ConfigProperty = {
      ...property,
      version: newVersion,
      lastModified: new Date(),
      modifiedBy: property.modifiedBy || "system",
    };

    // If the value is sensitive, we might want to encrypt it
    if (property.sensitive && property.encrypted) {
      newProperty.value = await this.encryptValue(property.value);
    }

    // Store previous version for rollback capability
    if (existingProperty) {
      this.addConfigVersion(property.key, {
        configId: property.key,
        value: existingProperty.value,
        version: existingProperty.version,
        timestamp: existingProperty.lastModified,
        author: existingProperty.modifiedBy,
        changeDescription: `Previous version before update to v${newVersion}`,
        rollbackAllowed: true,
      } as any);
    }

    // Update the config store
    this.configStore.set(property.key, newProperty);

    // Log the change
    this.auditConfigChange(
      "update",
      property.key,
      existingProperty?.value,
      property.value,
      property.modifiedBy || "system",
    );

    return { success: true, newVersion };
  }

  /**
   * Get a configuration property by key
   */
  async getConfigProperty(
    key: string,
    environment?: string,
  ): Promise<ConfigProperty | null> {
    const property = this.configStore.get(key);
    if (!property) {
      return null;
    }

    // If property is encrypted and sensitive, decrypt it before returning
    if (
      property.sensitive &&
      property.encrypted &&
      typeof property.value === "string"
    ) {
      property.value = await this.decryptValue(property.value);
    }

    // Add environment-specific overrides if needed
    // (In a real implementation, we would have environment-specific values)
    return { ...property };
  }

  /**
   * Get configuration value by key
   */
  async getConfigValue<T = any>(
    key: string,
    defaultValue?: T,
  ): Promise<T | undefined> {
    const property = await this.getConfigProperty(key);
    if (!property) {
      return defaultValue;
    }

    return property.value as T;
  }

  /**
   * Validate a configuration value against its validation rules
   */
  async validateConfigValue(
    key: string,
    value: any,
    validation?: ConfigProperty["validation"],
  ): Promise<{ valid: boolean; error?: string }> {
    if (!validation) {
      return { valid: true };
    }

    // Check required validation
    if (
      validation.required &&
      (value === undefined || value === null || value === "")
    ) {
      return {
        valid: false,
        error: `Configuration property ${key} is required`,
      };
    }

    // Check type validation
    if (validation.allowedValues && !validation.allowedValues.includes(value)) {
      return {
        valid: false,
        error: `Value for ${key} is not in allowed values: ${validation.allowedValues.join(", ")}`,
      };
    }

    // Check min/max for numbers
    if (typeof value === "number") {
      if (validation.min !== undefined && value < validation.min) {
        return {
          valid: false,
          error: `Value for ${key} is below minimum ${validation.min}`,
        };
      }
      if (validation.max !== undefined && value > validation.max) {
        return {
          valid: false,
          error: `Value for ${key} exceeds maximum ${validation.max}`,
        };
      }
    }

    // Check pattern validation
    if (validation.pattern && typeof value === "string") {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        return {
          valid: false,
          error: `Value for ${key} does not match required pattern`,
        };
      }
    }

    // Additional validation based on type
    if (validation.pattern === "email") {
      const emailValid = this.validationRules.get("email")?.(value) ?? true;
      if (!emailValid) {
        return {
          valid: false,
          error: `Value for ${key} is not a valid email address`,
        };
      }
    }

    if (validation.pattern === "url") {
      const urlValid = this.validationRules.get("url")?.(value) ?? true;
      if (!urlValid) {
        return { valid: false, error: `Value for ${key} is not a valid URL` };
      }
    }

    // Use AI guardrails for additional validation
    if (typeof value === "string") {
      const aiValidation = await this.aiGuardrails.validateInput(value);
      if (!aiValidation.allowed) {
        return {
          valid: false,
          error: `Value for ${key} failed AI validation: ${aiValidation.reason}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Add a configuration version for rollback capability
   */
  private addConfigVersion(
    key: string,
    version: Omit<ConfigVersion, "id" | "timestamp">,
  ): void {
    if (!this.configVersions.has(key)) {
      this.configVersions.set(key, []);
    }

    const versions = this.configVersions.get(key)!;

    // Add the new version
    const newVersion: ConfigVersion = {
      ...version,
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
    };

    versions.push(newVersion);

    // Keep only the most recent versions based on retention policy
    if (versions.length > this.versionRetentionCount) {
      versions.splice(0, versions.length - this.versionRetentionCount);
    }
  }

  /**
   * Rollback a configuration property to a previous version
   */
  async rollbackConfigProperty(
    key: string,
    version: number,
    userId: string,
    reason: string = "Configuration rollback",
  ): Promise<{ success: boolean; error?: string }> {
    const versions = this.configVersions.get(key);
    if (!versions) {
      return {
        success: false,
        error: `No versions found for config key ${key}`,
      };
    }

    // Find the specific version
    const targetVersion = versions.find((v) => v.version === version);
    if (!targetVersion || !targetVersion.rollbackAllowed) {
      return {
        success: false,
        error: `Version ${version} is not available for rollback for key ${key}`,
      };
    }

    // Create a new property based on the target version
    const currentProperty = this.configStore.get(key);
    if (!currentProperty) {
      return { success: false, error: `Current property ${key} not found` };
    }

    // Decrypt if needed
    let rollbackValue = targetVersion.value;
    if (currentProperty.sensitive && currentProperty.encrypted) {
      rollbackValue = await this.decryptValue(targetVersion.value);
    }

    // Create new property with rollback value
    const rollbackProperty: Omit<ConfigProperty, "lastModified" | "version"> &
      Partial<Pick<ConfigProperty, "version">> = {
      ...currentProperty,
      value: rollbackValue,
      version: currentProperty.version + 1, // Increment version
      modifiedBy: userId,
    };

    // Set the new property (which will handle versioning and encryption)
    const setResult = await this.setConfigProperty(rollbackProperty);
    if (!setResult.success) {
      return setResult;
    }

    // Log the rollback
    this.auditConfigChange(
      "update",
      key,
      currentProperty.value,
      rollbackValue,
      userId,
      reason,
    );

    return { success: true };
  }

  /**
   * Get configuration versions
   */
  getConfigVersions(key: string): ConfigVersion[] {
    return this.configVersions.get(key) || [];
  }

  /**
   * Create or update a configuration schema
   */
  setConfigSchema(
    schema: Omit<ConfigSchema, "createdAt" | "updatedAt"> &
      Partial<Pick<ConfigSchema, "createdAt">>,
  ): ConfigSchema {
    const now = new Date();
    const existingSchema = this.configSchemas.get(schema.id);

    const schemaObj: ConfigSchema = {
      ...schema,
      createdAt: existingSchema?.createdAt || now,
      updatedAt: now,
    };

    this.configSchemas.set(schema.id, schemaObj);
    return schemaObj;
  }

  /**
   * Get a configuration schema
   */
  getConfigSchema(id: string): ConfigSchema | undefined {
    return this.configSchemas.get(id);
  }

  /**
   * Validate a configuration object against a schema
   */
  async validateConfigAgainstSchema(
    schemaId: string,
    configObj: any,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const schema = this.getConfigSchema(schemaId);
    if (!schema) {
      return { valid: false, errors: [`Schema ${schemaId} not found`] };
    }

    const errors: string[] = [];

    // Validate required properties
    for (const prop of schema.properties) {
      if (
        prop.required &&
        (configObj[prop.key] === undefined || configObj[prop.key] === null)
      ) {
        errors.push(`Required property ${prop.key} is missing`);
      }
    }

    // Validate property values
    for (const prop of schema.properties) {
      if (configObj[prop.key] !== undefined) {
        const validation = await this.validateConfigValue(
          prop.key,
          configObj[prop.key],
          {
            ...prop.validation,
            required: prop.required,
          } as ConfigProperty["validation"],
        );

        if (!validation.valid) {
          errors.push(`Property ${prop.key}: ${validation.error}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Encrypt a sensitive configuration value
   */
  private async encryptValue(value: any): Promise<string> {
    // In a real implementation, this would use proper encryption
    // For demonstration, we'll use a simple encoding approach
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    return `encrypted_${btoa(stringValue)}`;
  }

  /**
   * Decrypt a sensitive configuration value
   */
  private async decryptValue(encryptedValue: string): Promise<any> {
    // In a real implementation, this would properly decrypt
    // For demonstration, we'll decode the simple encoding
    if (encryptedValue.startsWith("encrypted_")) {
      const encoded = encryptedValue.substring(10); // Remove 'encrypted_' prefix
      const decoded = atob(encoded);

      // Try to parse as JSON, otherwise return as string
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    }

    return encryptedValue;
  }

  /**
   * Get all configuration properties with optional filtering
   */
  getConfigProperties(filters?: {
    category?: string;
    tag?: string;
    sensitive?: boolean;
    environment?: string;
  }): ConfigProperty[] {
    let properties = Array.from(this.configStore.values());

    if (filters?.category) {
      properties = properties.filter((p) => p.category === filters.category);
    }

    if (filters?.tag) {
      properties = properties.filter((p) => p.tags?.includes(filters.tag!));
    }

    if (filters?.sensitive !== undefined) {
      properties = properties.filter((p) => p.sensitive === filters.sensitive);
    }

    if (filters?.environment) {
      properties = properties.filter(
        (p) => p.environment === filters.environment,
      );
    }

    return properties;
  }

  /**
   * Export configuration for backup or migration
   */
  exportConfiguration(includeSensitive: boolean = false): any {
    const exported: any = {
      timestamp: new Date(),
      properties: [] as ConfigProperty[],
      schemas: Array.from(this.configSchemas.values()),
      environments: Array.from(this.configEnvironments.values()),
    };

    for (const [key, property] of this.configStore.entries()) {
      if (includeSensitive || !property.sensitive) {
        // Don't include the actual sensitive values unless explicitly requested
        const exportedProperty = { ...property };
        if (property.sensitive && !includeSensitive) {
          exportedProperty.value = "***REDACTED***";
        }
        exported.properties.push(exportedProperty);
      }
    }

    return exported;
  }

  /**
   * Import configuration from exported data
   */
  async importConfiguration(
    configData: any,
    userId: string,
    overwrite: boolean = false,
  ): Promise<{ success: boolean; importedCount: number; errors: string[] }> {
    let importedCount = 0;
    const errors: string[] = [];

    if (!configData.properties || !Array.isArray(configData.properties)) {
      return {
        success: false,
        importedCount: 0,
        errors: ["Invalid config data format"],
      };
    }

    for (const property of configData.properties) {
      try {
        // Skip sensitive properties if they're redacted
        if (property.value === "***REDACTED***") {
          continue;
        }

        if (overwrite || !this.configStore.has(property.key)) {
          const result = await this.setConfigProperty({
            ...property,
            modifiedBy: userId,
          });

          if (result.success) {
            importedCount++;
          } else {
            errors.push(`Failed to import ${property.key}: ${result.error}`);
          }
        }
      } catch (error) {
        errors.push(
          `Error importing ${property.key}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    // Import schemas if available
    if (configData.schemas && Array.isArray(configData.schemas)) {
      for (const schema of configData.schemas) {
        try {
          this.setConfigSchema(schema);
        } catch (error) {
          errors.push(
            `Error importing schema ${schema.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    }

    return { success: errors.length === 0, importedCount, errors };
  }

  /**
   * Synchronize configuration with an external source
   */
  async syncConfiguration(
    source: string,
    target: string,
    syncConfig?: any,
  ): Promise<{ success: boolean; status: ConfigSyncStatus }> {
    const syncId = `${source}-to-${target}`;

    const syncStatus: ConfigSyncStatus = {
      source,
      target,
      lastSync: new Date(),
      status: "in-progress",
      error: undefined,
    };

    try {
      // Perform real configuration sync based on target type
      if (target === "cloudflare-workers") {
        // Sync to Cloudflare KV for Workers access
        await this.syncToCloudflareKV(syncConfig);
      } else if (target === "d1") {
        // Sync to D1 database
        await this.syncToD1(syncConfig);
      } else if (target === "r2") {
        // Sync to R2 as JSON file
        await this.syncToR2(syncConfig);
      } else if (target === "file") {
        // Sync to local filesystem
        await this.syncToFile(syncConfig);
      } else {
        throw new Error(`Unknown sync target: ${target}`);
      }

      // Update status to success
      syncStatus.status = "success";

      // Store sync status
      this.configSyncStatus.set(syncId, syncStatus);

      // Log the sync
      this.auditConfigChange(
        "sync",
        syncId,
        undefined,
        syncConfig,
        "system",
        `Sync from ${source} to ${target}`,
      );

      return { success: true, status: syncStatus };
    } catch (error) {
      syncStatus.status = "failed";
      syncStatus.error =
        error instanceof Error ? error.message : "Unknown error";
      this.configSyncStatus.set(syncId, syncStatus);

      return { success: false, status: syncStatus };
    }
  }

  /**
   * Get sync status between systems
   */
  getSyncStatus(source: string, target: string): ConfigSyncStatus | undefined {
    const syncId = `${source}-to-${target}`;
    return this.configSyncStatus.get(syncId);
  }

  /**
   * Audit configuration change for compliance
   */
  private auditConfigChange(
    action: "create" | "update" | "delete" | "read" | "sync" | "validate",
    key: string,
    oldValue: any,
    newValue: any,
    userId: string,
    details?: string,
  ): void {
    const auditLog: ConfigAuditLog = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      action,
      key,
      oldValue,
      newValue,
      timestamp: new Date(),
      userId,
      ipAddress: undefined, // Would be provided by the calling function
      userAgent: undefined, // Would be provided by the calling function
      environment: "default", // Would be determined by context
      result: "success",
      details,
    };

    this.auditLogs.push(auditLog);

    // Keep only recent logs (e.g., last 1000)
    if (this.auditLogs.length > 1000) {
      this.auditLogs = this.auditLogs.slice(-1000);
    }
  }

  /**
   * Get configuration audit logs
   */
  getAuditLogs(filters?: {
    userId?: string;
    action?: string;
    key?: string;
    startDate?: Date;
    endDate?: Date;
  }): ConfigAuditLog[] {
    let logs = [...this.auditLogs];

    if (filters?.userId) {
      logs = logs.filter((log) => log.userId === filters.userId);
    }

    if (filters?.action) {
      logs = logs.filter((log) => log.action === filters.action);
    }

    if (filters?.key) {
      logs = logs.filter((log) => log.key === filters.key);
    }

    if (filters?.startDate) {
      logs = logs.filter((log) => log.timestamp >= filters.startDate!);
    }

    if (filters?.endDate) {
      logs = logs.filter((log) => log.timestamp <= filters.endDate!);
    }

    return logs;
  }

  /**
   * Get configuration statistics and metrics
   */
  getConfigMetrics(): any {
    return {
      totalProperties: this.configStore.size,
      totalSchemas: this.configSchemas.size,
      totalEnvironments: this.configEnvironments.size,
      sensitiveProperties: Array.from(this.configStore.values()).filter(
        (p) => p.sensitive,
      ).length,
      encryptedProperties: Array.from(this.configStore.values()).filter(
        (p) => p.encrypted,
      ).length,
      categories: Array.from(
        new Set(
          Array.from(this.configStore.values())
            .map((p) => p.category)
            .filter(Boolean),
        ),
      ),
      tags: Array.from(
        new Set(
          Array.from(this.configStore.values()).flatMap((p) => p.tags || []),
        ),
      ),
      lastUpdated: new Date(
        Math.max(
          ...Array.from(this.configStore.values()).map((p) =>
            p.lastModified.getTime(),
          ),
        ),
      ),
      totalAuditLogs: this.auditLogs.length,
    };
  }

  /**
   * Reload configuration from environment variables or external source
   */
  async reloadConfiguration(): Promise<{
    success: boolean;
    updatedCount: number;
    errors: string[];
  }> {
    let updatedCount = 0;
    const errors: string[] = [];

    // In a real implementation, this would reload from the source
    // For this example, we'll update the existing values with any environment changes

    const config = this.configService.getConfig();

    // Update known configuration values from the config service
    const updates = [
      { key: "cf.account.id", value: config.cfAccountId },
      { key: "cf.api.token", value: config.cfApiToken },
      { key: "ai.gateway.url", value: config.cfGatewayUrl },
      { key: "security.jwt.secret", value: config.securityJwtSecret },
      { key: "learning.enabled", value: config.selfHealingEnabled },
    ];

    for (const update of updates) {
      try {
        const current = await this.getConfigProperty(update.key);
        if (current && current.value !== update.value) {
          const result = await this.setConfigProperty({
            ...current,
            value: update.value,
            modifiedBy: "system",
          } as any);

          if (result.success) {
            updatedCount++;
          } else {
            errors.push(`Failed to update ${update.key}: ${result.error}`);
          }
        }
      } catch (error) {
        errors.push(
          `Error updating ${update.key}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    return { success: errors.length === 0, updatedCount, errors };
  }

  /**
   * Validate all configurations against their schemas
   */
  async validateAllConfigs(): Promise<{
    valid: boolean;
    propertiesValid: number;
    propertiesInvalid: number;
    errors: Array<{ key: string; errors: string[] }>;
  }> {
    let propertiesValid = 0;
    let propertiesInvalid = 0;
    const errors: Array<{ key: string; errors: string[] }> = [];

    for (const [key, property] of this.configStore.entries()) {
      // Try to find a schema that might apply to this property
      // In a real implementation, we might have a more sophisticated mapping
      let isValid = true;

      // Validate using the property's own validation rules
      if (property.validation) {
        const result = await this.validateConfigValue(
          key,
          property.value,
          property.validation,
        );
        if (!result.valid) {
          isValid = false;
          errors.push({
            key,
            errors: [result.error || "Unknown validation error"],
          });
          propertiesInvalid++;
        }
      }

      if (isValid) {
        propertiesValid++;
      }
    }

    return {
      valid: propertiesInvalid === 0,
      propertiesValid,
      propertiesInvalid,
      errors,
    };
  }

  /**
   * Sync configuration to Cloudflare KV
   */
  private async syncToCloudflareKV(config: Record<string, any>): Promise<void> {
    const accountId = process.env.CF_ACCOUNT_ID;
    const apiToken = process.env.CF_API_TOKEN;
    const namespaceId = process.env.CF_KV_CONFIG_NAMESPACE_ID;

    if (!accountId || !apiToken || !namespaceId) {
      throw new Error("Cloudflare credentials not configured for KV sync");
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`;

    // Convert config to KV format
    const kvPairs = Object.entries(config).map(([key, value]) => ({
      key: `config:${key}`,
      value: JSON.stringify(value),
    }));

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(kvPairs),
    });

    if (!response.ok) {
      throw new Error(`KV sync failed: ${await response.text()}`);
    }

    console.log(`✅ Synced ${kvPairs.length} config keys to Cloudflare KV`);
  }

  /**
   * Sync configuration to D1 database
   */
  private async syncToD1(config: Record<string, any>): Promise<void> {
    const accountId = process.env.CF_ACCOUNT_ID;
    const apiToken = process.env.CF_API_TOKEN;
    const databaseId = process.env.CF_D1_DATABASE_ID;

    if (!accountId || !apiToken || !databaseId) {
      throw new Error("Cloudflare credentials not configured for D1 sync");
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

    // Ensure config table exists
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: `CREATE TABLE IF NOT EXISTS app_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      }),
    });

    // Insert/update each config value
    for (const [key, value] of Object.entries(config)) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql: `INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)`,
          params: [key, JSON.stringify(value), new Date().toISOString()],
        }),
      });

      if (!response.ok) {
        console.error(`Failed to sync ${key} to D1:`, await response.text());
      }
    }

    console.log(`✅ Synced ${Object.keys(config).length} config keys to D1`);
  }

  /**
   * Sync configuration to R2 storage
   */
  private async syncToR2(config: Record<string, any>): Promise<void> {
    const accountId = process.env.CF_ACCOUNT_ID;
    const apiToken = process.env.CF_API_TOKEN;
    const bucketName = process.env.CF_R2_BUCKET_NAME || "agent-storage";

    if (!accountId || !apiToken) {
      throw new Error("Cloudflare credentials not configured for R2 sync");
    }

    const key = `config/app-config-${new Date().toISOString()}.json`;
    const url = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config, null, 2),
    });

    if (!response.ok) {
      throw new Error(`R2 sync failed: ${await response.text()}`);
    }

    console.log(`✅ Synced config to R2: ${key}`);
  }

  /**
   * Sync configuration to local file
   */
  private async syncToFile(config: Record<string, any>): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");

    const configDir = process.env.CONFIG_SYNC_PATH || "./data/config";
    const filePath = path.join(
      configDir,
      `config-${new Date().toISOString()}.json`,
    );

    // Ensure directory exists
    await fs.mkdir(configDir, { recursive: true });

    // Write config to file
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));

    console.log(`✅ Synced config to file: ${filePath}`);
  }
}

// Initialize Advanced Configuration Management middleware
export const initializeAdvancedConfigManagement = async (
  c: Context,
  next: () => Promise<void>,
) => {
  const aiGuardrailsService = c.get("aiGuardrailsService");
  const configService = c.get("configService");

  if (!aiGuardrailsService || !configService) {
    console.error(
      "AI Guardrails or Config service not initialized for advanced config management",
    );
    throw new Error(
      "Required services not available for advanced config management",
    );
  }

  const advancedConfigManagementService = new AdvancedConfigManagementService(
    aiGuardrailsService,
    configService,
  );
  c.set("advancedConfigManagementService", advancedConfigManagementService);

  await next();
};
