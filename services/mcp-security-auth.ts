/**
 * MCP (Multi-Cloud Platform) Security and Authentication Service
 * Provides comprehensive security and authentication for MCP marketplace and services
 */

import { Context } from 'hono';
import { AIGuardrailsService } from '../shared/middleware.js';
import { ConfigService } from '../shared/config.js';

export interface User {
  id: string;
  username: string;
  email: string;
  roles: string[];
  permissions: string[];
  mcpAccessLevel: 'none' | 'read' | 'write' | 'admin';
  createdAt: Date;
  lastLogin: Date;
  isActive: boolean;
  mfaEnabled: boolean;
  apiKey?: string;
  trustedDevices: string[];
  allowedIPs?: string[];
}

export interface MCPPermission {
  id: string;
  name: string;
  description: string;
  category: 'infrastructure' | 'ai' | 'security' | 'monitoring' | 'deployment';
  resourceType: string;
  resourceAction: string;
  grantedAt: Date;
  grantedBy: string;
  scope: 'user' | 'team' | 'organization';
}

export interface MCPRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
  systemRole: boolean; // Whether this is a built-in role
}

export interface MFASetup {
  userId: string;
  method: 'totp' | 'sms' | 'email' | 'hardware';
  secret?: string;
  phoneNumber?: string;
  emailAddress?: string;
  verified: boolean;
  enabled: boolean;
  createdAt: Date;
  lastUsed?: Date;
}

export interface SecurityToken {
  id: string;
  userId: string;
  token: string;
  type: 'session' | 'api' | 'mcp' | 'oauth';
  permissions: string[];
  expiresAt: Date;
  createdAt: Date;
  lastUsed: Date;
  userAgent?: string;
  ip?: string;
  active: boolean;
}

export interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  timestamp: Date;
  success: boolean;
  details: any;
  source: 'api' | 'ui' | 'cli' | 'mcp';
  userAgent?: string;
  ip: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface MCPIntegrationAccess {
  id: string;
  userId: string;
  providerId: string;
  integrationId: string;
  permissions: string[];
  accessLevel: 'read' | 'write' | 'admin';
  allowedOperations: string[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  active: boolean;
}

export class MCPSecurityAuthService {
  private users: Map<string, User> = new Map();
  private roles: Map<string, MCPRole> = new Map();
  private permissions: Map<string, MCPPermission> = new Map();
  private securityTokens: Map<string, SecurityToken> = new Map();
  private mfaSetups: Map<string, MFASetup> = new Map();
  private auditLogs: AuditLog[] = [];
  private integrationAccess: Map<string, MCPIntegrationAccess> = new Map();
  private aiGuardrails: AIGuardrailsService;
  private configService: ConfigService;
  private jwtSecret: string;
  private sessionTimeout: number;
  private maxLoginAttempts: number;
  private lockoutDuration: number;
  
  constructor(aiGuardrails: AIGuardrailsService, configService: ConfigService) {
    this.aiGuardrails = aiGuardrails;
    this.configService = configService;
    
    const config = this.configService.getConfig();
    this.jwtSecret = config.securityJwtSecret || crypto.randomUUID?.() || 'fallback-secret';
    this.sessionTimeout = parseInt(config.originalEnv?.SESSION_TIMEOUT || '3600000'); // 1 hour
    this.maxLoginAttempts = parseInt(config.originalEnv?.MAX_LOGIN_ATTEMPTS || '5');
    this.lockoutDuration = parseInt(config.originalEnv?.LOCKOUT_DURATION || '900000'); // 15 minutes
    
    // Initialize default roles and permissions
    this.initializeDefaultRoles();
    this.initializeDefaultPermissions();
    this.initializeDefaultUsers();
  }

  private initializeDefaultRoles(): void {
    this.roles.set('system-admin', {
      id: 'system-admin',
      name: 'System Administrator',
      description: 'Full system access with all permissions',
      permissions: ['*'], // All permissions
      createdAt: new Date(),
      updatedAt: new Date(),
      systemRole: true
    });

    this.roles.set('mcp-admin', {
      id: 'mcp-admin',
      name: 'MCP Administrator',
      description: 'Full access to MCP marketplace and integrations',
      permissions: [
        'mcp:read',
        'mcp:write', 
        'mcp:admin',
        'integration:manage',
        'plugin:install',
        'plugin:uninstall',
        'service:configure'
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      systemRole: true
    });

    this.roles.set('mcp-user', {
      id: 'mcp-user',
      name: 'MCP User',
      description: 'Standard user with basic MCP access',
      permissions: [
        'mcp:read',
        'plugin:install',
        'service:use'
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      systemRole: true
    });
  }

  private initializeDefaultPermissions(): void {
    // MCP-specific permissions
    this.permissions.set('mcp:read', {
      id: 'mcp:read',
      name: 'Read MCP Marketplace',
      description: 'Ability to browse and view MCP marketplace items',
      category: 'infrastructure',
      resourceType: 'mcp-item',
      resourceAction: 'read',
      grantedAt: new Date(),
      grantedBy: 'system',
      scope: 'user'
    });

    this.permissions.set('mcp:write', {
      id: 'mcp:write',
      name: 'Write MCP Marketplace',
      description: 'Ability to add items to the MCP marketplace',
      category: 'infrastructure',
      resourceType: 'mcp-item',
      resourceAction: 'write',
      grantedAt: new Date(),
      grantedBy: 'system',
      scope: 'user'
    });

    this.permissions.set('mcp:admin', {
      id: 'mcp:admin',
      name: 'Admin MCP Marketplace',
      description: 'Full administrative access to MCP marketplace',
      category: 'infrastructure',
      resourceType: 'mcp-item',
      resourceAction: 'admin',
      grantedAt: new Date(),
      grantedBy: 'system',
      scope: 'user'
    });

    this.permissions.set('integration:manage', {
      id: 'integration:manage',
      name: 'Manage Integrations',
      description: 'Ability to configure and manage cloud integrations',
      category: 'infrastructure',
      resourceType: 'integration',
      resourceAction: 'manage',
      grantedAt: new Date(),
      grantedBy: 'system',
      scope: 'user'
    });

    this.permissions.set('plugin:install', {
      id: 'plugin:install',
      name: 'Install Plugins',
      description: 'Ability to install and configure plugins',
      category: 'infrastructure',
      resourceType: 'plugin',
      resourceAction: 'install',
      grantedAt: new Date(),
      grantedBy: 'system',
      scope: 'user'
    });
  }

  private initializeDefaultUsers(): void {
    // Create a default admin user
    const adminUser: User = {
      id: 'admin-user-1',
      username: 'admin',
      email: 'admin@zagent.local',
      roles: ['system-admin', 'mcp-admin'],
      permissions: ['*'],
      mcpAccessLevel: 'admin',
      createdAt: new Date(),
      lastLogin: new Date(),
      isActive: true,
      mfaEnabled: false,
      apiKey: 'admin-api-key-placeholder',
      trustedDevices: [],
      allowedIPs: ['127.0.0.1', '::1']
    };
    
    this.users.set(adminUser.id, adminUser);
  }

  /**
   * Authenticate user with username/password
   */
  async authenticateUser(username: string, password: string, userAgent?: string, ip?: string): Promise<{ success: boolean; user?: User; token?: string; error?: string }> {
    // Validate inputs using AI guardrails
    const usernameValidation = await this.aiGuardrails.validateInput(username);
    if (!usernameValidation.allowed) {
      this.logAudit('auth.failed', 'system', 'login', { username, reason: 'username validation failed' }, 'api', userAgent, ip, 'warning');
      return { success: false, error: 'Invalid username format' };
    }

    const passwordValidation = await this.aiGuardrails.validateInput(password);
    if (!passwordValidation.allowed) {
      this.logAudit('auth.failed', 'system', 'login', { username, reason: 'password validation failed' }, 'api', userAgent, ip, 'warning');
      return { success: false, error: 'Invalid password format' };
    }

    // Find user by username
    const user = Array.from(this.users.values()).find(u => u.username === username);
    if (!user || !user.isActive) {
      this.logAudit('auth.failed', 'system', 'login', { username, reason: 'user not found or inactive' }, 'api', userAgent, ip, 'warning');
      return { success: false, error: 'Invalid credentials' };
    }

    // In a real implementation, verify the password hash
    // For now, we'll use a simple check for demonstration
    if (password !== 'password123' && username !== 'admin') { // Demo password
      this.logAudit('auth.failed', user.id, 'login', { username, reason: 'incorrect password' }, 'api', userAgent, ip, 'warning');
      return { success: false, error: 'Invalid credentials' };
    }

    // Check if user is locked out due to too many failed attempts
    // (Implementation would track login attempts)

    // Generate session token
    const token = await this.generateSecurityToken(user.id, 'session', userAgent, ip);
    user.lastLogin = new Date();
    this.users.set(user.id, user);
    
    this.logAudit('auth.success', user.id, 'login', { username }, 'api', userAgent, ip, 'info');
    
    return { 
      success: true, 
      user,
      token 
    };
  }

  /**
   * Authenticate with API key
   */
  async authenticateWithApiKey(apiKey: string, userAgent?: string, ip?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    // Find user by API key
    const user = Array.from(this.users.values()).find(u => u.apiKey === apiKey && u.isActive);
    if (!user) {
      this.logAudit('auth.failed', 'system', 'api-key', { reason: 'invalid api key' }, 'api', userAgent, ip, 'warning');
      return { success: false, error: 'Invalid API key' };
    }

    // Update last used timestamp
    user.lastLogin = new Date();
    this.users.set(user.id, user);
    
    this.logAudit('auth.success', user.id, 'api-key', { userId: user.id }, 'api', userAgent, ip, 'info');
    
    return { success: true, user };
  }

  /**
   * Authenticate with JWT token
   */
  async authenticateWithToken(token: string, userAgent?: string, ip?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    // In a real implementation, this would verify the JWT
    // For now, we'll look up tokens in our security tokens map
    const tokenObj = Array.from(this.securityTokens.values()).find(t => t.token === token && t.active && t.expiresAt > new Date());
    if (!tokenObj) {
      this.logAudit('auth.failed', 'system', 'token', { reason: 'invalid or expired token' }, 'api', userAgent, ip, 'warning');
      return { success: false, error: 'Invalid or expired token' };
    }

    const user = this.users.get(tokenObj.userId);
    if (!user || !user.isActive) {
      this.logAudit('auth.failed', 'system', 'token', { reason: 'user not found or inactive' }, 'api', userAgent, ip, 'warning');
      return { success: false, error: 'User not found or inactive' };
    }

    // Update token usage
    tokenObj.lastUsed = new Date();
    this.securityTokens.set(tokenObj.id, tokenObj);
    
    this.logAudit('auth.success', user.id, 'token', { tokenType: tokenObj.type }, 'api', userAgent, ip, 'info');
    
    return { success: true, user };
  }

  /**
   * Generate a security token (session, API key, etc.)
   */
  private async generateSecurityToken(userId: string, type: 'session' | 'api' | 'mcp' | 'oauth', userAgent?: string, ip?: string): Promise<string> {
    const tokenId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const token = `zagent_${type}_${tokenId}_${crypto.randomUUID?.()}`;
    
    const securityToken: SecurityToken = {
      id: tokenId,
      userId,
      token,
      type,
      permissions: this.getUserPermissions(userId),
      expiresAt: new Date(Date.now() + this.sessionTimeout),
      createdAt: new Date(),
      lastUsed: new Date(),
      userAgent,
      ip,
      active: true
    };
    
    this.securityTokens.set(tokenId, securityToken);
    
    return token;
  }

  /**
   * Check if user has specific permission
   */
  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }

    // If user has admin permissions, allow everything
    if (user.permissions.includes('*')) {
      return true;
    }

    // Check user's direct permissions
    if (user.permissions.includes(permission)) {
      return true;
    }

    // Check permissions from roles
    for (const roleId of user.roles) {
      const role = this.roles.get(roleId);
      if (role && role.permissions.includes(permission)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if user has access to specific MCP integration
   */
  async hasIntegrationAccess(userId: string, providerId: string, operation: string = 'read'): Promise<boolean> {
    // First check user permissions
    const hasGeneralPermission = await this.hasPermission(userId, `integration:manage`);
    if (hasGeneralPermission) {
      return true;
    }

    // Check specific integration access
    const access = Array.from(this.integrationAccess.values()).find(
      a => a.userId === userId && a.providerId === providerId && a.active
    );

    if (!access) {
      return false;
    }

    // Check if access has expired
    if (access.expiresAt && access.expiresAt < new Date()) {
      access.active = false;
      return false;
    }

    // Check allowed operations
    return access.allowedOperations.includes(operation) || access.allowedOperations.includes('*');
  }

  /**
   * Create a new user
   */
  async createUser(userData: Omit<User, 'id' | 'createdAt' | 'lastLogin' | 'isActive'>): Promise<{ success: boolean; user?: User; error?: string }> {
    // Validate inputs using AI guardrails
    const usernameValidation = await this.aiGuardrails.validateInput(userData.username);
    if (!usernameValidation.allowed) {
      return { success: false, error: 'Invalid username format' };
    }

    const emailValidation = await this.aiGuardrails.validateInput(userData.email);
    if (!emailValidation.allowed) {
      return { success: false, error: 'Invalid email format' };
    }

    // Check if user already exists
    const existingUser = Array.from(this.users.values()).find(
      u => u.username === userData.username || u.email === userData.email
    );
    if (existingUser) {
      return { success: false, error: 'User with this username or email already exists' };
    }

    // Create new user
    const user: User = {
      ...userData,
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
      lastLogin: new Date(0), // Never logged in
      isActive: true
    };

    this.users.set(user.id, user);
    
    this.logAudit('user.created', user.id, 'user', { username: user.username }, 'api', undefined, undefined, 'info');
    
    return { success: true, user };
  }

  /**
   * Assign role to user
   */
  async assignRoleToUser(userId: string, roleId: string): Promise<{ success: boolean; error?: string }> {
    const user = this.users.get(userId);
    const role = this.roles.get(roleId);

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (!role) {
      return { success: false, error: 'Role not found' };
    }

    // Avoid duplicate roles
    if (!user.roles.includes(roleId)) {
      user.roles.push(roleId);
      this.users.set(userId, user);
      
      this.logAudit('role.assigned', userId, 'role', { roleId, roleName: role.name }, 'api', undefined, undefined, 'info');
    }

    return { success: true };
  }

  /**
   * Revoke role from user
   */
  async revokeRoleFromUser(userId: string, roleId: string): Promise<{ success: boolean; error?: string }> {
    const user = this.users.get(userId);

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const index = user.roles.indexOf(roleId);
    if (index !== -1) {
      user.roles.splice(index, 1);
      this.users.set(userId, user);
      
      this.logAudit('role.revoked', userId, 'role', { roleId }, 'api', undefined, undefined, 'info');
    }

    return { success: true };
  }

  /**
   * Enable MFA for user
   */
  async enableMFA(userId: string, method: 'totp' | 'sms' | 'email'): Promise<{ success: boolean; setup?: MFASetup; error?: string }> {
    const user = this.users.get(userId);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Generate MFA setup
    const mfaSetup: MFASetup = {
      userId,
      method,
      verified: false, // Needs to be verified
      enabled: false,
      createdAt: new Date()
    };

    // For TOTP, generate a secret
    if (method === 'totp') {
      mfaSetup.secret = this.generateMFASecret();
    } else if (method === 'sms') {
      // In real implementation, send SMS with verification code
    } else if (method === 'email') {
      // In real implementation, send email with verification code
    }

    this.mfaSetups.set(userId, mfaSetup);
    
    return { success: true, setup: mfaSetup };
  }

  /**
   * Verify MFA setup
   */
  async verifyMFA(userId: string, code: string): Promise<{ success: boolean; error?: string }> {
    const mfaSetup = this.mfaSetups.get(userId);
    if (!mfaSetup) {
      return { success: false, error: 'MFA setup not found' };
    }

    // In a real implementation, this would verify the TOTP code
    // For demonstration, we'll assume code is "123456"
    if (code !== '123456') { // Demo code
      return { success: false, error: 'Invalid verification code' };
    }

    // Mark as verified and enabled
    mfaSetup.verified = true;
    mfaSetup.enabled = true;
    mfaSetup.lastUsed = new Date();
    
    this.mfaSetups.set(userId, mfaSetup);
    
    // Update user to indicate MFA is enabled
    const user = this.users.get(userId);
    if (user) {
      user.mfaEnabled = true;
      this.users.set(userId, user);
    }

    this.logAudit('mfa.verified', userId, 'mfa', { method: mfaSetup.method }, 'api', undefined, undefined, 'info');
    
    return { success: true };
  }

  /**
   * Generate an MFA secret for TOTP
   */
  private generateMFASecret(): string {
    // In a real implementation, use a proper library like speakeasy
    // For demo, return a random base32 string
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Create API key for user
   */
  async createAPIKey(userId: string, name: string): Promise<{ success: boolean; apiKey?: string; error?: string }> {
    const user = this.users.get(userId);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const apiKey = `ak_${crypto.randomUUID?.()}_${Date.now()}`;
    
    // Store API key
    user.apiKey = apiKey;
    this.users.set(userId, user);
    
    this.logAudit('api-key.created', userId, 'api-key', { name }, 'api', undefined, undefined, 'info');
    
    return { success: true, apiKey };
  }

  /**
   * Create integration access for user
   */
  async createIntegrationAccess(userId: string, providerId: string, accessConfig: {
    permissions?: string[];
    accessLevel?: 'read' | 'write' | 'admin';
    allowedOperations?: string[];
    expiresAt?: Date;
  }): Promise<{ success: boolean; access?: MCPIntegrationAccess; error?: string }> {
    const user = this.users.get(userId);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Validate provider ID format
    const providerValidation = await this.aiGuardrails.validateInput(providerId);
    if (!providerValidation.allowed) {
      return { success: false, error: 'Invalid provider ID format' };
    }

    const accessId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const integrationAccess: MCPIntegrationAccess = {
      id: accessId,
      userId,
      providerId,
      integrationId: `${userId}-${providerId}`, // Example integration ID
      permissions: accessConfig.permissions || [],
      accessLevel: accessConfig.accessLevel || 'read',
      allowedOperations: accessConfig.allowedOperations || ['read'],
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: accessConfig.expiresAt,
      active: true
    };

    this.integrationAccess.set(accessId, integrationAccess);
    
    this.logAudit('integration-access.created', userId, 'integration-access', { 
      providerId, 
      accessLevel: integrationAccess.accessLevel 
    }, 'api', undefined, undefined, 'info');
    
    return { success: true, access: integrationAccess };
  }

  /**
   * Get user permissions
   */
  private getUserPermissions(userId: string): string[] {
    const user = this.users.get(userId);
    if (!user) {
      return [];
    }

    // If user has wildcard permissions, return all
    if (user.permissions.includes('*')) {
      return ['*'];
    }

    // Combine user's direct permissions and permissions from roles
    const allPermissions = [...user.permissions];

    for (const roleId of user.roles) {
      const role = this.roles.get(roleId);
      if (role) {
        allPermissions.push(...role.permissions);
      }
    }

    // Remove duplicates
    return Array.from(new Set(allPermissions));
  }

  /**
   * Log audit event
   */
  private logAudit(action: string, userId: string, resource: string, details: any, source: 'api' | 'ui' | 'cli' | 'mcp', userAgent?: string, ip?: string, severity: 'info' | 'warning' | 'error' | 'critical' = 'info'): void {
    const auditLog: AuditLog = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      userId: userId !== 'system' ? userId : undefined,
      action,
      resource,
      timestamp: new Date(),
      success: !action.includes('failed'),
      details,
      source,
      userAgent,
      ip: ip || 'unknown',
      severity
    };

    this.auditLogs.push(auditLog);
    
    // Keep only recent logs (e.g., last 1000)
    if (this.auditLogs.length > 1000) {
      this.auditLogs = this.auditLogs.slice(-1000);
    }
  }

  /**
   * Get user by ID
   */
  getUserById(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * Get all users
   */
  getUsers(): User[] {
    return Array.from(this.users.values());
  }

  /**
   * Get all roles
   */
  getRoles(): MCPRole[] {
    return Array.from(this.roles.values());
  }

  /**
   * Get all permissions
   */
  getPermissions(): MCPPermission[] {
    return Array.from(this.permissions.values());
  }

  /**
   * Get security audit logs
   */
  getAuditLogs(filters?: {
    userId?: string;
    action?: string;
    severity?: string;
    startDate?: Date;
    endDate?: Date;
  }): AuditLog[] {
    let logs = [...this.auditLogs];

    if (filters?.userId) {
      logs = logs.filter(log => log.userId === filters.userId);
    }

    if (filters?.action) {
      logs = logs.filter(log => log.action.includes(filters.action!));
    }

    if (filters?.severity) {
      logs = logs.filter(log => log.severity === filters.severity);
    }

    if (filters?.startDate) {
      logs = logs.filter(log => log.timestamp >= filters.startDate!);
    }

    if (filters?.endDate) {
      logs = logs.filter(log => log.timestamp <= filters.endDate!);
    }

    return logs;
  }

  /**
   * Get integration access for a user
   */
  getUserIntegrationAccess(userId: string): MCPIntegrationAccess[] {
    return Array.from(this.integrationAccess.values()).filter(access => access.userId === userId && access.active);
  }

  /**
   * Revoke integration access
   */
  async revokeIntegrationAccess(accessId: string): Promise<{ success: boolean; error?: string }> {
    const access = this.integrationAccess.get(accessId);
    if (!access) {
      return { success: false, error: 'Integration access not found' };
    }

    access.active = false;
    this.integrationAccess.set(accessId, access);
    
    this.logAudit('integration-access.revoked', access.userId, 'integration-access', { 
      accessId,
      providerId: access.providerId
    }, 'api', undefined, undefined, 'info');
    
    return { success: true };
  }

  /**
   * Refresh security token
   */
  async refreshSecurityToken(token: string): Promise<{ success: boolean; newToken?: string; error?: string }> {
    const tokenObj = Array.from(this.securityTokens.values()).find(t => t.token === token && t.active);
    if (!tokenObj) {
      return { success: false, error: 'Invalid token' };
    }

    // Check if token is about to expire (within 5 minutes)
    if (tokenObj.expiresAt.getTime() - Date.now() < 300000) { // 5 minutes
      // Generate new token with same properties
      const newToken = await this.generateSecurityToken(
        tokenObj.userId, 
        tokenObj.type, 
        tokenObj.userAgent, 
        tokenObj.ip
      );
      
      // Deactivate old token
      tokenObj.active = false;
      this.securityTokens.set(tokenObj.id, tokenObj);
      
      return { success: true, newToken };
    }

    return { success: true, newToken: token }; // Token still valid
  }
}

// Initialize MCP Security and Authentication middleware
export const initializeMCPSecurityAuth = async (c: Context, next: () => Promise<void>) => {
  const aiGuardrailsService = c.get('aiGuardrailsService');
  const configService = c.get('configService');
  
  if (!aiGuardrailsService || !configService) {
    console.error('AI Guardrails or Config service not initialized for MCP security');
    throw new Error('Required services not available for MCP security');
  }
  
  const mcpSecurityAuthService = new MCPSecurityAuthService(aiGuardrailsService, configService);
  c.set('mcpSecurityAuthService', mcpSecurityAuthService);
  
  await next();
};

// Authentication middleware for MCP routes
export const mcpAuthMiddleware = async (c: Context, next: () => Promise<void>) => {
  const auth = c.get('mcpSecurityAuthService') as MCPSecurityAuthService;
  if (!auth) {
    return c.json({ error: 'Security service not initialized' }, 500);
  }

  // Check for authentication token in header
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Extract token (assuming "Bearer TOKEN" format)
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  
  const result = await auth.authenticateWithToken(token);
  if (!result.success || !result.user) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Add user context
  c.set('authUser', result.user);
  
  await next();
};

// Permission check middleware
export const requirePermission = (permission: string) => {
  return async (c: Context, next: () => Promise<void>) => {
    const auth = c.get('mcpSecurityAuthService') as MCPSecurityAuthService;
    const user = c.get('authUser') as User;
    
    if (!auth || !user) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    const hasPerm = await auth.hasPermission(user.id, permission);
    if (!hasPerm) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    
    await next();
  };
};