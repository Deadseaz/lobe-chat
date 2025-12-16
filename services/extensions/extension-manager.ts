/**
 * Extension Manager - Central hub for all external service integrations
 * 
 * Supports:
 * - GitHub (repos, issues, PRs, actions)
 * - Cloudflare (DNS, Workers, AI Gateway, R2)
 * - Zapier (webhooks, zaps, automation)
 * - Google (Search, Drive, Sheets, Gmail)
 * - xAI (Grok API)
 * - Claude (Anthropic API)
 * - Builder.io (visual builder)
 * - And more...
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { storage } from '../../shared/storage';

export interface Extension {
  id: string;
  name: string;
  description: string;
  category: 'ai' | 'automation' | 'storage' | 'communication' | 'development' | 'analytics';
  icon: string;
  enabled: boolean;
  configured: boolean;
  requiredCredentials: string[];
  capabilities: string[];
  endpoints: Record<string, string>;
}

export interface ExtensionCredentials {
  extensionId: string;
  credentials: Record<string, string>;
  expiresAt?: Date;
}

export interface ExtensionAction {
  extension: string;
  action: string;
  params: Record<string, any>;
}

export interface ExtensionResult {
  success: boolean;
  extension: string;
  action: string;
  data?: any;
  error?: string;
}

/**
 * Extension Manager - Manages all external integrations
 */
export class ExtensionManager {
  private extensions: Map<string, Extension> = new Map();
  private credentials: Map<string, ExtensionCredentials> = new Map();
  private adapters: Map<string, ExtensionAdapter> = new Map();

  constructor() {
    this.registerBuiltInExtensions();
  }

  /**
   * Register all built-in extensions
   */
  private registerBuiltInExtensions(): void {
    // GitHub Extension
    this.extensions.set('github', {
      id: 'github',
      name: 'GitHub',
      description: 'Manage repositories, issues, PRs, and GitHub Actions',
      category: 'development',
      icon: '🐙',
      enabled: false,
      configured: false,
      requiredCredentials: ['GITHUB_TOKEN'],
      capabilities: [
        'create-repo', 'list-repos', 'create-issue', 'list-issues',
        'create-pr', 'merge-pr', 'trigger-workflow', 'get-commits',
        'create-branch', 'push-code', 'review-pr'
      ],
      endpoints: {
        api: 'https://api.github.com',
        graphql: 'https://api.github.com/graphql'
      }
    });

    // Cloudflare Extension
    this.extensions.set('cloudflare', {
      id: 'cloudflare',
      name: 'Cloudflare',
      description: 'Manage DNS, Workers, R2 storage, and AI Gateway',
      category: 'development',
      icon: '☁️',
      enabled: false,
      configured: false,
      requiredCredentials: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
      capabilities: [
        'manage-dns', 'deploy-worker', 'manage-r2', 'ai-gateway',
        'create-tunnel', 'manage-firewall', 'analytics', 'pages-deploy'
      ],
      endpoints: {
        api: 'https://api.cloudflare.com/client/v4',
        aiGateway: 'https://gateway.ai.cloudflare.com/v1'
      }
    });

    // Zapier Extension
    this.extensions.set('zapier', {
      id: 'zapier',
      name: 'Zapier',
      description: 'Automate workflows with 5000+ apps',
      category: 'automation',
      icon: '⚡',
      enabled: false,
      configured: false,
      requiredCredentials: ['ZAPIER_WEBHOOK_URL', 'ZAPIER_API_KEY'],
      capabilities: [
        'trigger-webhook', 'create-zap', 'list-zaps', 'run-zap',
        'send-data', 'schedule-task'
      ],
      endpoints: {
        webhooks: 'https://hooks.zapier.com',
        api: 'https://api.zapier.com/v1'
      }
    });

    // Google Extension
    this.extensions.set('google', {
      id: 'google',
      name: 'Google',
      description: 'Google Search, Drive, Sheets, Gmail, Calendar',
      category: 'communication',
      icon: '🔍',
      enabled: false,
      configured: false,
      requiredCredentials: ['GOOGLE_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      capabilities: [
        'web-search', 'create-doc', 'create-sheet', 'upload-drive',
        'send-email', 'create-event', 'translate', 'vision-api'
      ],
      endpoints: {
        search: 'https://www.googleapis.com/customsearch/v1',
        drive: 'https://www.googleapis.com/drive/v3',
        sheets: 'https://sheets.googleapis.com/v4',
        gmail: 'https://gmail.googleapis.com/gmail/v1'
      }
    });

    // xAI (Grok) Extension
    this.extensions.set('xai', {
      id: 'xai',
      name: 'xAI (Grok)',
      description: 'Access Grok AI for advanced reasoning and real-time info',
      category: 'ai',
      icon: '🤖',
      enabled: false,
      configured: false,
      requiredCredentials: ['XAI_API_KEY'],
      capabilities: [
        'chat', 'code-generation', 'analysis', 'real-time-search',
        'reasoning', 'summarization'
      ],
      endpoints: {
        api: 'https://api.x.ai/v1'
      }
    });

    // Claude (Anthropic) Extension
    this.extensions.set('claude', {
      id: 'claude',
      name: 'Claude (Anthropic)',
      description: 'Claude AI for analysis, coding, and creative tasks',
      category: 'ai',
      icon: '🧠',
      enabled: false,
      configured: false,
      requiredCredentials: ['ANTHROPIC_API_KEY'],
      capabilities: [
        'chat', 'code-generation', 'analysis', 'document-qa',
        'creative-writing', 'tool-use', 'vision'
      ],
      endpoints: {
        api: 'https://api.anthropic.com/v1'
      }
    });

    // Builder.io Extension
    this.extensions.set('builder', {
      id: 'builder',
      name: 'Builder.io',
      description: 'Visual page builder and headless CMS',
      category: 'development',
      icon: '🏗️',
      enabled: false,
      configured: false,
      requiredCredentials: ['BUILDER_API_KEY', 'BUILDER_PRIVATE_KEY'],
      capabilities: [
        'create-page', 'edit-content', 'publish', 'get-content',
        'manage-models', 'generate-code'
      ],
      endpoints: {
        api: 'https://builder.io/api/v1',
        content: 'https://cdn.builder.io/api/v1'
      }
    });

    // OpenAI Extension
    this.extensions.set('openai', {
      id: 'openai',
      name: 'OpenAI',
      description: 'GPT-4, DALL-E, Whisper, and more',
      category: 'ai',
      icon: '🌟',
      enabled: false,
      configured: false,
      requiredCredentials: ['OPENAI_API_KEY'],
      capabilities: [
        'chat', 'code-generation', 'image-generation', 'speech-to-text',
        'embeddings', 'fine-tuning', 'assistants'
      ],
      endpoints: {
        api: 'https://api.openai.com/v1'
      }
    });

    // Slack Extension
    this.extensions.set('slack', {
      id: 'slack',
      name: 'Slack',
      description: 'Send messages, manage channels, integrate workflows',
      category: 'communication',
      icon: '💬',
      enabled: false,
      configured: false,
      requiredCredentials: ['SLACK_BOT_TOKEN', 'SLACK_WEBHOOK_URL'],
      capabilities: [
        'send-message', 'create-channel', 'upload-file', 'react',
        'schedule-message', 'manage-users'
      ],
      endpoints: {
        api: 'https://slack.com/api'
      }
    });

    // Discord Extension
    this.extensions.set('discord', {
      id: 'discord',
      name: 'Discord',
      description: 'Manage Discord servers, send messages, create bots',
      category: 'communication',
      icon: '🎮',
      enabled: false,
      configured: false,
      requiredCredentials: ['DISCORD_BOT_TOKEN', 'DISCORD_WEBHOOK_URL'],
      capabilities: [
        'send-message', 'manage-channels', 'manage-roles', 'create-embed',
        'voice-connect', 'slash-commands'
      ],
      endpoints: {
        api: 'https://discord.com/api/v10'
      }
    });

    // Notion Extension
    this.extensions.set('notion', {
      id: 'notion',
      name: 'Notion',
      description: 'Manage pages, databases, and knowledge bases',
      category: 'storage',
      icon: '📝',
      enabled: false,
      configured: false,
      requiredCredentials: ['NOTION_API_KEY'],
      capabilities: [
        'create-page', 'create-database', 'query-database', 'update-page',
        'search', 'manage-blocks'
      ],
      endpoints: {
        api: 'https://api.notion.com/v1'
      }
    });

    // AWS Extension
    this.extensions.set('aws', {
      id: 'aws',
      name: 'Amazon Web Services',
      description: 'S3, Lambda, EC2, and other AWS services',
      category: 'development',
      icon: '☁️',
      enabled: false,
      configured: false,
      requiredCredentials: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
      capabilities: [
        's3-upload', 's3-download', 'lambda-invoke', 'ec2-manage',
        'ses-email', 'dynamodb', 'sqs-queue'
      ],
      endpoints: {}
    });

    // Stripe Extension
    this.extensions.set('stripe', {
      id: 'stripe',
      name: 'Stripe',
      description: 'Payment processing and subscription management',
      category: 'automation',
      icon: '💳',
      enabled: false,
      configured: false,
      requiredCredentials: ['STRIPE_SECRET_KEY'],
      capabilities: [
        'create-payment', 'create-customer', 'manage-subscriptions',
        'create-invoice', 'refund', 'webhooks'
      ],
      endpoints: {
        api: 'https://api.stripe.com/v1'
      }
    });

    // Airtable Extension
    this.extensions.set('airtable', {
      id: 'airtable',
      name: 'Airtable',
      description: 'Database and spreadsheet hybrid',
      category: 'storage',
      icon: '📊',
      enabled: false,
      configured: false,
      requiredCredentials: ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'],
      capabilities: [
        'create-record', 'update-record', 'query-records', 'delete-record',
        'manage-tables', 'automations'
      ],
      endpoints: {
        api: 'https://api.airtable.com/v0'
      }
    });

    // Twilio Extension
    this.extensions.set('twilio', {
      id: 'twilio',
      name: 'Twilio',
      description: 'SMS, voice calls, and messaging',
      category: 'communication',
      icon: '📱',
      enabled: false,
      configured: false,
      requiredCredentials: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
      capabilities: [
        'send-sms', 'make-call', 'send-whatsapp', 'verify-phone',
        'voice-response', 'messaging-service'
      ],
      endpoints: {
        api: 'https://api.twilio.com/2010-04-01'
      }
    });

    // Hugging Face Extension
    this.extensions.set('huggingface', {
      id: 'huggingface',
      name: 'Hugging Face',
      description: 'Open-source AI models and inference',
      category: 'ai',
      icon: '🤗',
      enabled: false,
      configured: false,
      requiredCredentials: ['HUGGINGFACE_API_KEY'],
      capabilities: [
        'inference', 'text-generation', 'image-classification',
        'embeddings', 'speech', 'translation'
      ],
      endpoints: {
        api: 'https://api-inference.huggingface.co/models'
      }
    });
  }

  /**
   * Initialize extension manager
   */
  async initialize(): Promise<void> {
    // Load saved credentials and enabled state
    const saved = await storage.get('extensions:config');
    if (saved) {
      const config = JSON.parse(saved);
      for (const [id, state] of Object.entries(config)) {
        const ext = this.extensions.get(id);
        if (ext) {
          Object.assign(ext, state);
        }
      }
    }

    // Load credentials
    const creds = await storage.get('extensions:credentials');
    if (creds) {
      const parsed = JSON.parse(creds);
      for (const [id, data] of Object.entries(parsed)) {
        this.credentials.set(id, data as ExtensionCredentials);
      }
    }

    // Initialize adapters for enabled extensions
    for (const [id, ext] of this.extensions) {
      if (ext.enabled && ext.configured) {
        await this.initializeAdapter(id);
      }
    }

    console.log('[ExtensionManager] Initialized with', this.extensions.size, 'extensions');
  }

  /**
   * Initialize an adapter for an extension
   */
  private async initializeAdapter(extensionId: string): Promise<void> {
    const creds = this.credentials.get(extensionId);
    if (!creds) return;

    // Create adapter based on extension type
    const AdapterClass = this.getAdapterClass(extensionId);
    if (AdapterClass) {
      const adapter = new AdapterClass(creds.credentials);
      this.adapters.set(extensionId, adapter);
    }
  }

  /**
   * Get adapter class for extension
   */
  private getAdapterClass(extensionId: string): any {
    // Return adapter classes - these are defined below
    const adapters: Record<string, any> = {
      'github': GitHubAdapter,
      'cloudflare': CloudflareAdapter,
      'zapier': ZapierAdapter,
      'google': GoogleAdapter,
      'xai': XAIAdapter,
      'claude': ClaudeAdapter,
      'openai': OpenAIAdapter,
      'slack': SlackAdapter,
      'notion': NotionAdapter
    };
    return adapters[extensionId];
  }

  /**
   * List all extensions
   */
  listExtensions(): Extension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Get extension by ID
   */
  getExtension(id: string): Extension | undefined {
    return this.extensions.get(id);
  }

  /**
   * Configure extension with credentials
   */
  async configureExtension(extensionId: string, credentials: Record<string, string>): Promise<boolean> {
    const ext = this.extensions.get(extensionId);
    if (!ext) return false;

    // Validate all required credentials are provided
    for (const req of ext.requiredCredentials) {
      if (!credentials[req]) {
        throw new Error(`Missing required credential: ${req}`);
      }
    }

    // Save credentials
    this.credentials.set(extensionId, {
      extensionId,
      credentials
    });

    ext.configured = true;

    // Save to storage
    await this.saveConfig();
    await this.saveCredentials();

    return true;
  }

  /**
   * Enable extension
   */
  async enableExtension(extensionId: string): Promise<boolean> {
    const ext = this.extensions.get(extensionId);
    if (!ext) return false;

    if (!ext.configured) {
      throw new Error('Extension must be configured before enabling');
    }

    ext.enabled = true;
    await this.initializeAdapter(extensionId);
    await this.saveConfig();

    return true;
  }

  /**
   * Disable extension
   */
  async disableExtension(extensionId: string): Promise<boolean> {
    const ext = this.extensions.get(extensionId);
    if (!ext) return false;

    ext.enabled = false;
    this.adapters.delete(extensionId);
    await this.saveConfig();

    return true;
  }

  /**
   * Execute action on extension
   */
  async executeAction(action: ExtensionAction): Promise<ExtensionResult> {
    const ext = this.extensions.get(action.extension);
    if (!ext) {
      return { success: false, extension: action.extension, action: action.action, error: 'Extension not found' };
    }

    if (!ext.enabled) {
      return { success: false, extension: action.extension, action: action.action, error: 'Extension not enabled' };
    }

    const adapter = this.adapters.get(action.extension);
    if (!adapter) {
      return { success: false, extension: action.extension, action: action.action, error: 'Adapter not initialized' };
    }

    try {
      const data = await adapter.execute(action.action, action.params);
      return { success: true, extension: action.extension, action: action.action, data };
    } catch (error) {
      return { 
        success: false, 
        extension: action.extension, 
        action: action.action, 
        error: error instanceof Error ? error.message : 'Execution failed'
      };
    }
  }

  /**
   * Save config to storage
   */
  private async saveConfig(): Promise<void> {
    const config: Record<string, any> = {};
    for (const [id, ext] of this.extensions) {
      config[id] = { enabled: ext.enabled, configured: ext.configured };
    }
    await storage.set('extensions:config', JSON.stringify(config));
  }

  /**
   * Save credentials to storage
   */
  private async saveCredentials(): Promise<void> {
    const creds: Record<string, ExtensionCredentials> = {};
    for (const [id, data] of this.credentials) {
      creds[id] = data;
    }
    await storage.set('extensions:credentials', JSON.stringify(creds));
  }
}

/**
 * Base Extension Adapter
 */
export abstract class ExtensionAdapter {
  protected credentials: Record<string, string>;

  constructor(credentials: Record<string, string>) {
    this.credentials = credentials;
  }

  abstract execute(action: string, params: Record<string, any>): Promise<any>;
}

/**
 * GitHub Adapter
 */
export class GitHubAdapter extends ExtensionAdapter {
  private baseUrl = 'https://api.github.com';

  async execute(action: string, params: Record<string, any>): Promise<any> {
    const headers = {
      'Authorization': `Bearer ${this.credentials.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    switch (action) {
      case 'list-repos':
        return this.fetch('/user/repos', 'GET', headers);
      
      case 'create-repo':
        return this.fetch('/user/repos', 'POST', headers, {
          name: params.name,
          description: params.description,
          private: params.private ?? false
        });
      
      case 'create-issue':
        return this.fetch(`/repos/${params.owner}/${params.repo}/issues`, 'POST', headers, {
          title: params.title,
          body: params.body,
          labels: params.labels
        });
      
      case 'list-issues':
        return this.fetch(`/repos/${params.owner}/${params.repo}/issues`, 'GET', headers);
      
      case 'create-pr':
        return this.fetch(`/repos/${params.owner}/${params.repo}/pulls`, 'POST', headers, {
          title: params.title,
          head: params.head,
          base: params.base,
          body: params.body
        });

      case 'get-commits':
        return this.fetch(`/repos/${params.owner}/${params.repo}/commits`, 'GET', headers);

      case 'trigger-workflow':
        return this.fetch(
          `/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow}/dispatches`,
          'POST',
          headers,
          { ref: params.ref || 'main', inputs: params.inputs }
        );

      default:
        throw new Error(`Unknown GitHub action: ${action}`);
    }
  }

  private async fetch(path: string, method: string, headers: Record<string, string>, body?: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return response.json();
  }
}

/**
 * Cloudflare Adapter
 */
export class CloudflareAdapter extends ExtensionAdapter {
  private baseUrl = 'https://api.cloudflare.com/client/v4';

  async execute(action: string, params: Record<string, any>): Promise<any> {
    const headers = {
      'Authorization': `Bearer ${this.credentials.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    };
    const accountId = this.credentials.CLOUDFLARE_ACCOUNT_ID;

    switch (action) {
      case 'list-zones':
        return this.fetch('/zones', 'GET', headers);
      
      case 'manage-dns':
        if (params.action === 'create') {
          return this.fetch(`/zones/${params.zoneId}/dns_records`, 'POST', headers, {
            type: params.type,
            name: params.name,
            content: params.content,
            ttl: params.ttl || 1,
            proxied: params.proxied ?? true
          });
        }
        return this.fetch(`/zones/${params.zoneId}/dns_records`, 'GET', headers);
      
      case 'deploy-worker':
        return this.fetch(
          `/accounts/${accountId}/workers/scripts/${params.name}`,
          'PUT',
          { ...headers, 'Content-Type': 'application/javascript' },
          params.script
        );
      
      case 'ai-gateway':
        const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${params.gateway}`;
        return fetch(`${gatewayUrl}/${params.provider}/${params.endpoint}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.credentials.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(params.body)
        }).then(r => r.json());

      case 'manage-r2':
        // R2 bucket operations
        return this.fetch(`/accounts/${accountId}/r2/buckets`, params.method || 'GET', headers, params.body);

      default:
        throw new Error(`Unknown Cloudflare action: ${action}`);
    }
  }

  private async fetch(path: string, method: string, headers: Record<string, string>, body?: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined
    });
    return response.json();
  }
}

/**
 * Zapier Adapter
 */
export class ZapierAdapter extends ExtensionAdapter {
  async execute(action: string, params: Record<string, any>): Promise<any> {
    switch (action) {
      case 'trigger-webhook':
        const webhookUrl = params.webhookUrl || this.credentials.ZAPIER_WEBHOOK_URL;
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params.data)
        });
        return response.json();

      case 'send-data':
        return fetch(this.credentials.ZAPIER_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params)
        }).then(r => r.json());

      default:
        throw new Error(`Unknown Zapier action: ${action}`);
    }
  }
}

/**
 * Google Adapter
 */
export class GoogleAdapter extends ExtensionAdapter {
  async execute(action: string, params: Record<string, any>): Promise<any> {
    const apiKey = this.credentials.GOOGLE_API_KEY;

    switch (action) {
      case 'web-search':
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${this.credentials.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(params.query)}`;
        return fetch(searchUrl).then(r => r.json());

      case 'translate':
        const translateUrl = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
        return fetch(translateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q: params.text,
            target: params.target,
            source: params.source
          })
        }).then(r => r.json());

      default:
        throw new Error(`Unknown Google action: ${action}`);
    }
  }
}

/**
 * xAI (Grok) Adapter
 */
export class XAIAdapter extends ExtensionAdapter {
  private baseUrl = 'https://api.x.ai/v1';

  async execute(action: string, params: Record<string, any>): Promise<any> {
    const headers = {
      'Authorization': `Bearer ${this.credentials.XAI_API_KEY}`,
      'Content-Type': 'application/json'
    };

    switch (action) {
      case 'chat':
        return fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: params.model || 'grok-beta',
            messages: params.messages,
            temperature: params.temperature
          })
        }).then(r => r.json());

      case 'real-time-search':
        return fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'grok-beta',
            messages: [
              { role: 'system', content: 'Search the web for current information.' },
              { role: 'user', content: params.query }
            ]
          })
        }).then(r => r.json());

      default:
        throw new Error(`Unknown xAI action: ${action}`);
    }
  }
}

/**
 * Claude (Anthropic) Adapter
 */
export class ClaudeAdapter extends ExtensionAdapter {
  private baseUrl = 'https://api.anthropic.com/v1';

  async execute(action: string, params: Record<string, any>): Promise<any> {
    const headers = {
      'x-api-key': this.credentials.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    };

    switch (action) {
      case 'chat':
        return fetch(`${this.baseUrl}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: params.model || 'claude-3-opus-20240229',
            max_tokens: params.maxTokens || 4096,
            messages: params.messages
          })
        }).then(r => r.json());

      case 'tool-use':
        return fetch(`${this.baseUrl}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: params.model || 'claude-3-opus-20240229',
            max_tokens: params.maxTokens || 4096,
            messages: params.messages,
            tools: params.tools
          })
        }).then(r => r.json());

      default:
        throw new Error(`Unknown Claude action: ${action}`);
    }
  }
}

/**
 * OpenAI Adapter
 */
export class OpenAIAdapter extends ExtensionAdapter {
  private baseUrl = 'https://api.openai.com/v1';

  async execute(action: string, params: Record<string, any>): Promise<any> {
    const headers = {
      'Authorization': `Bearer ${this.credentials.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    };

    switch (action) {
      case 'chat':
        return fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: params.model || 'gpt-4',
            messages: params.messages,
            temperature: params.temperature
          })
        }).then(r => r.json());

      case 'image-generation':
        return fetch(`${this.baseUrl}/images/generations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: params.prompt,
            size: params.size || '1024x1024',
            n: params.n || 1
          })
        }).then(r => r.json());

      case 'embeddings':
        return fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: params.model || 'text-embedding-3-small',
            input: params.input
          })
        }).then(r => r.json());

      default:
        throw new Error(`Unknown OpenAI action: ${action}`);
    }
  }
}

/**
 * Slack Adapter
 */
export class SlackAdapter extends ExtensionAdapter {
  private baseUrl = 'https://slack.com/api';

  async execute(action: string, params: Record<string, any>): Promise<any> {
    const headers = {
      'Authorization': `Bearer ${this.credentials.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    };

    switch (action) {
      case 'send-message':
        return fetch(`${this.baseUrl}/chat.postMessage`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            channel: params.channel,
            text: params.text,
            blocks: params.blocks
          })
        }).then(r => r.json());

      case 'webhook':
        return fetch(this.credentials.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: params.text, blocks: params.blocks })
        });

      default:
        throw new Error(`Unknown Slack action: ${action}`);
    }
  }
}

/**
 * Notion Adapter
 */
export class NotionAdapter extends ExtensionAdapter {
  private baseUrl = 'https://api.notion.com/v1';

  async execute(action: string, params: Record<string, any>): Promise<any> {
    const headers = {
      'Authorization': `Bearer ${this.credentials.NOTION_API_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    };

    switch (action) {
      case 'create-page':
        return fetch(`${this.baseUrl}/pages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: { database_id: params.databaseId },
            properties: params.properties,
            children: params.children
          })
        }).then(r => r.json());

      case 'query-database':
        return fetch(`${this.baseUrl}/databases/${params.databaseId}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filter: params.filter,
            sorts: params.sorts
          })
        }).then(r => r.json());

      case 'search':
        return fetch(`${this.baseUrl}/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: params.query,
            filter: params.filter
          })
        }).then(r => r.json());

      default:
        throw new Error(`Unknown Notion action: ${action}`);
    }
  }
}

// Export singleton
export const extensionManager = new ExtensionManager();
