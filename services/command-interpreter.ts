/**
 * Command Interpreter Service
 * Enables full system management via natural language chat
 * 
 * Users can type commands like:
 * - "deploy a redis container"
 * - "show me the system status"
 * - "add a feature for slack notifications"
 * - "run terraform plan"
 * - "what agents are running?"
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { aiGateway } from '../shared/services';
import { storage } from '../shared/storage';

// Fetch is globally available in Node 18+
const nodeFetch = globalThis.fetch;

export interface CommandResult {
  success: boolean;
  action: string;
  message: string;
  data?: any;
  suggestedFollowUp?: string[];
}

export interface ParsedCommand {
  intent: CommandIntent;
  confidence: number;
  entities: Record<string, any>;
  originalText: string;
}

export type CommandIntent = 
  // System
  | 'system_status' | 'system_health' | 'system_capabilities'
  // Agents
  | 'list_agents' | 'agent_status' | 'submit_task' | 'execute_task'
  // Agent Factory - Dynamic Agent Creation
  | 'create_agent' | 'agent_factory_status' | 'stop_agent' | 'agent_logs' | 'list_created_agents'
  // Docker
  | 'docker_list' | 'docker_run' | 'docker_stop' | 'docker_pull' | 'docker_logs'
  // Terraform
  | 'terraform_status' | 'terraform_init' | 'terraform_plan' | 'terraform_apply' | 'terraform_destroy' | 'terraform_state'
  // Knowledge
  | 'knowledge_add' | 'knowledge_query' | 'knowledge_search'
  // Security
  | 'security_analyze' | 'security_status' | 'security_rules'
  // Features
  | 'feature_request' | 'feature_list' | 'feature_status'
  // Config
  | 'config_get' | 'config_set' | 'config_list'
  // Extensions - External Service Integrations
  | 'extension_list' | 'extension_enable' | 'extension_configure' | 'extension_use'
  // GitHub specific
  | 'github_repos' | 'github_issues' | 'github_pr' | 'github_action'
  // Cloudflare specific
  | 'cloudflare_dns' | 'cloudflare_worker' | 'cloudflare_ai'
  // AI providers
  | 'use_claude' | 'use_grok' | 'use_openai'
  // Zapier/automation
  | 'zapier_trigger' | 'zapier_send'
  // Google
  | 'google_search' | 'google_drive'
  // Communication
  | 'slack_send' | 'discord_send' | 'notion_create'
  // Learning
  | 'learning_stats' | 'learning_suggest'
  // Chat/AI
  | 'chat' | 'help' | 'unknown';

interface CommandHandler {
  intent: CommandIntent;
  patterns: RegExp[];
  description: string;
  examples: string[];
  handler: (entities: Record<string, any>, context: CommandContext) => Promise<CommandResult>;
}

interface CommandContext {
  userId?: string;
  sessionId?: string;
  history: string[];
}

/**
 * Command Interpreter - Natural Language to System Actions
 */
export class CommandInterpreter {
  private handlers: Map<CommandIntent, CommandHandler> = new Map();
  private conversationHistory: Map<string, string[]> = new Map();
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3003') {
    this.baseUrl = baseUrl;
    this.registerHandlers();
  }

  /**
   * Register all command handlers
   */
  private registerHandlers(): void {
    // ============ SYSTEM COMMANDS ============
    this.addHandler({
      intent: 'system_status',
      patterns: [
        /\b(system|server|service)\s*(status|health|state|info)\b/i,
        /\bhow.*(system|server|everything)\s*(doing|running|status)\b/i,
        /\bstatus\s*of\s*(the\s*)?(system|server|everything)\b/i,
        /\bwhat.*status\b/i,
        /\bshow\s*(me\s*)?(the\s*)?status\b/i
      ],
      description: 'Get system status and health',
      examples: ['system status', 'how is the system doing?', 'show me the status'],
      handler: async () => {
        const response = await this.apiCall('/api/status');
        return {
          success: true,
          action: 'system_status',
          message: `System Status:\n` +
            `• Agents: ${response.agents?.length || 0} active\n` +
            `• Services: Redis ${response.services?.redis ? '✅' : '❌'}, Vectors ${response.services?.vectors ? '✅' : '❌'}\n` +
            `• Security: Guardrails ${response.security?.guardrails ? 'ON' : 'OFF'}`,
          data: response,
          suggestedFollowUp: ['list agents', 'show capabilities', 'check security']
        };
      }
    });

    this.addHandler({
      intent: 'system_capabilities',
      patterns: [
        /\b(what|show|list).*(capabilities|can you do|features|abilities)\b/i,
        /\bcapabilities\b/i,
        /\bwhat\s+can\s+(you|the system|this)\s+do\b/i
      ],
      description: 'List system capabilities',
      examples: ['what can you do?', 'show capabilities', 'list features'],
      handler: async () => {
        const response = await this.apiCall('/api/adaptability/capabilities');
        return {
          success: true,
          action: 'system_capabilities',
          message: `System Capabilities:\n\n` +
            `**Agents:** ${response.agents?.join(', ')}\n\n` +
            `**Services:** ${response.services?.join(', ')}\n\n` +
            `**Features:**\n${response.features?.map((f: string) => `• ${f}`).join('\n')}`,
          data: response,
          suggestedFollowUp: ['submit a feature request', 'list agents', 'get suggestions']
        };
      }
    });

    // ============ AGENT COMMANDS ============
    this.addHandler({
      intent: 'list_agents',
      patterns: [
        /\b(list|show|get|what).*(agents?|workers?)\b/i,
        /\bagents?\s*(list|status|running)\b/i,
        /\bwho.*(running|active|working)\b/i
      ],
      description: 'List all agents',
      examples: ['list agents', 'show me the agents', 'what agents are running?'],
      handler: async () => {
        const response = await this.apiCall('/api/agents');
        const agents = response.agents || [];
        return {
          success: true,
          action: 'list_agents',
          message: `Active Agents (${agents.length}):\n` +
            agents.map((a: any) => `• **${a.name}** (${a.type}) - ${a.status || 'ready'}`).join('\n'),
          data: response,
          suggestedFollowUp: ['submit a task', 'check system status']
        };
      }
    });

    this.addHandler({
      intent: 'submit_task',
      patterns: [
        /\b(submit|create|add|run)\s*(a\s*)?(task|job)\b/i,
        /\btask\s*:\s*(.+)/i,
        /\bdo\s*:\s*(.+)/i
      ],
      description: 'Submit a task to agents',
      examples: ['submit task: check server health', 'run task to deploy container'],
      handler: async (entities) => {
        const description = entities.taskDescription || entities.text || 'Task from chat';
        const response = await this.apiCall('/api/tasks', 'POST', {
          type: entities.taskType || 'general',
          description,
          payload: entities.payload || {}
        });
        return {
          success: response.success,
          action: 'submit_task',
          message: response.success 
            ? `✅ Task submitted successfully!\nTask ID: ${response.taskId}`
            : `❌ Failed to submit task: ${response.error}`,
          data: response,
          suggestedFollowUp: ['check task status', 'list agents']
        };
      }
    });

    // ============ AGENT FACTORY - CREATE AGENTS ON DEMAND ============
    this.addHandler({
      intent: 'create_agent',
      patterns: [
        /\b(create|build|make|spin up|deploy|launch)\s*(a\s*)?(new\s*)?(agent|subagent|bot|assistant|worker|service)\s*(for|to|that|which)?\s*(.+)/i,
        /\b(i\s+)?(want|need)\s*(a\s*)?(agent|subagent|bot|assistant)\s*(for|to|that|which)?\s*(.+)/i,
        /\blet'?s?\s*(create|build|make)\s*(a\s*)?(agent|subagent|system|pipeline)\s*(.+)/i,
        /\bagent\s*:\s*(.+)/i
      ],
      description: 'Create a new agent from natural language description',
      examples: [
        'create an agent to monitor stock prices',
        'build a subagent for sentiment analysis',
        'I need an agent that scrapes product reviews',
        'create a Fortigate expert agent',
        'spin up a team of agents to handle affiliate marketing'
      ],
      handler: async (entities) => {
        const description = entities.description || entities.text;
        if (!description || description.length < 10) {
          return {
            success: false,
            action: 'create_agent',
            message: `Please describe what you want the agent to do.\n\n**Examples:**\n` +
              `• "create an agent to monitor historic stock data with sentiment analysis"\n` +
              `• "build a Fortigate network expert agent"\n` +
              `• "create subagents for affiliate marketing with social analysis"`
          };
        }

        const response = await this.apiCall('/api/factory/create', 'POST', { description });
        
        if (response.success) {
          return {
            success: true,
            action: 'create_agent',
            message: `🚀 **Agent Creation Started!**\n\n` +
              `**ID:** ${response.blueprint.id}\n` +
              `**Status:** ${response.blueprint.status}\n\n` +
              `I'm analyzing your requirements and will:\n` +
              `1. Design the agent architecture\n` +
              `2. Generate the code\n` +
              `3. Build a Docker container\n` +
              `4. Deploy and start it\n\n` +
              `This may take 1-3 minutes. Check progress with: "agent status ${response.blueprint.id}"`,
            data: response,
            suggestedFollowUp: [`agent status ${response.blueprint.id}`, 'list my agents']
          };
        } else {
          return {
            success: false,
            action: 'create_agent',
            message: `❌ Failed to create agent: ${response.error}`,
            data: response
          };
        }
      }
    });

    this.addHandler({
      intent: 'agent_factory_status',
      patterns: [
        /\bagent\s*(creation\s*)?(status|progress)\s*:?\s*(\S+)?/i,
        /\bstatus\s*(of\s*)?(agent|creation)\s*:?\s*(\S+)?/i,
        /\bhow\s*is\s*(my\s*)?(agent|creation)\s*(\S+)?\s*(going|doing)?/i,
        /\bcheck\s*(on\s*)?(agent|creation)\s*(\S+)?/i
      ],
      description: 'Check agent creation status',
      examples: ['agent status agent-123', 'how is my agent doing?', 'check creation status'],
      handler: async (entities) => {
        const agentId = entities.agentId || entities.text?.match(/agent-\S+/)?.[0];
        
        if (agentId) {
          const response = await this.apiCall(`/api/factory/status/${agentId}`);
          if (response.blueprint) {
            const bp = response.blueprint;
            const statusEmojiMap: Record<string, string> = {
              'planning': '🔍',
              'generating': '⚙️',
              'building': '🔨',
              'deploying': '🚀',
              'running': '✅',
              'failed': '❌'
            };
            const statusEmoji = statusEmojiMap[bp.status as string] || '❓';

            return {
              success: true,
              action: 'agent_factory_status',
              message: `${statusEmoji} **Agent: ${bp.name || bp.id}**\n\n` +
                `**Status:** ${bp.status}\n` +
                `**Type:** ${bp.type}\n` +
                `**Capabilities:** ${bp.capabilities?.join(', ') || 'TBD'}\n` +
                (bp.endpoints ? `**Endpoints:** ${bp.endpoints.join(', ')}\n` : '') +
                (bp.error ? `**Error:** ${bp.error}\n` : '') +
                `**Created:** ${new Date(bp.createdAt).toLocaleString()}` +
                (bp.deployedAt ? `\n**Deployed:** ${new Date(bp.deployedAt).toLocaleString()}` : ''),
              data: response,
              suggestedFollowUp: bp.status === 'running' 
                ? [`talk to agent ${bp.id}`, `agent logs ${bp.id}`]
                : ['list my agents']
            };
          }
        }
        
        // List all agents if no specific ID
        const response = await this.apiCall('/api/factory/agents');
        const agents = response.agents || [];
        
        return {
          success: true,
          action: 'agent_factory_status',
          message: agents.length > 0
            ? `**Your Created Agents (${agents.length}):**\n\n` +
              agents.map((a: any) => 
                `• **${a.name}** [${a.status}]\n  ID: ${a.id}\n  Capabilities: ${a.capabilities?.slice(0, 3).join(', ')}...`
              ).join('\n\n')
            : 'No agents created yet. Try: "create an agent to monitor stocks"',
          data: response,
          suggestedFollowUp: ['create a new agent', 'system status']
        };
      }
    });

    this.addHandler({
      intent: 'list_created_agents',
      patterns: [
        /\b(list|show|get)\s*(my\s*)?(created\s*)?(agents?|bots?|workers?)/i,
        /\bwhat\s*agents?\s*(did\s*)?(i|we)\s*(create|have|make)/i,
        /\bmy\s*agents?\b/i
      ],
      description: 'List all agents you created',
      examples: ['list my agents', 'show created agents', 'what agents did I create?'],
      handler: async () => {
        const response = await this.apiCall('/api/factory/agents');
        const agents = response.agents || [];
        
        return {
          success: true,
          action: 'list_created_agents',
          message: agents.length > 0
            ? `**Your Agents (${agents.length}):**\n\n` +
              agents.map((a: any, i: number) => 
                `${i + 1}. **${a.name}** [${a.status === 'running' ? '🟢 Running' : '⚫ ' + a.status}]\n` +
                `   ID: \`${a.id}\`\n` +
                `   ${a.capabilities?.slice(0, 3).join(', ')}`
              ).join('\n\n')
            : '**No agents created yet!**\n\nTry:\n• "create an agent to analyze stock sentiment"\n• "build a web scraper agent"\n• "make a Fortigate expert agent"',
          data: response,
          suggestedFollowUp: agents.length > 0 
            ? ['create another agent', `talk to ${agents[0]?.name}`]
            : ['create an agent']
        };
      }
    });

    this.addHandler({
      intent: 'stop_agent',
      patterns: [
        /\b(stop|kill|remove|delete|terminate)\s*(the\s*)?(agent|bot|worker)\s*:?\s*(\S+)?/i,
        /\bagent\s*(stop|kill|remove|delete)\s*:?\s*(\S+)?/i
      ],
      description: 'Stop and remove a created agent',
      examples: ['stop agent agent-123', 'kill my stock agent', 'remove agent'],
      handler: async (entities) => {
        const agentId = entities.agentId || entities.text?.match(/agent-\S+/)?.[0];
        
        if (!agentId) {
          return {
            success: false,
            action: 'stop_agent',
            message: 'Please specify which agent to stop. Use "list my agents" to see available agents.'
          };
        }

        const response = await this.apiCall(`/api/factory/stop/${agentId}`, 'POST');
        
        return {
          success: response.success,
          action: 'stop_agent',
          message: response.success
            ? `✅ Agent ${agentId} has been stopped and removed.`
            : `❌ Failed to stop agent: ${response.error}`,
          suggestedFollowUp: ['list my agents']
        };
      }
    });

    this.addHandler({
      intent: 'agent_logs',
      patterns: [
        /\b(show|get|view)\s*(the\s*)?(logs?|output)\s*(for|of|from)?\s*(agent)?\s*:?\s*(\S+)?/i,
        /\bagent\s*logs?\s*:?\s*(\S+)?/i
      ],
      description: 'View logs from a created agent',
      examples: ['show logs for agent-123', 'agent logs stock-agent'],
      handler: async (entities) => {
        const agentId = entities.agentId || entities.text?.match(/agent-\S+/)?.[0] || entities.text?.match(/(\S+-agent|\S+agent)/)?.[0];
        
        if (!agentId) {
          return {
            success: false,
            action: 'agent_logs',
            message: 'Please specify which agent. Use "list my agents" to see available agents.'
          };
        }

        const response = await this.apiCall(`/api/factory/logs/${agentId}`);
        
        return {
          success: true,
          action: 'agent_logs',
          message: `**Logs for ${agentId}:**\n\`\`\`\n${response.logs?.substring(0, 1500) || 'No logs available'}\n\`\`\``,
          data: response
        };
      }
    });

    // ============ DOCKER COMMANDS ============
    this.addHandler({
      intent: 'docker_list',
      patterns: [
        /\b(list|show|get)\s*(docker\s*)?(containers?|images?)\b/i,
        /\bdocker\s*(ps|list|containers?)\b/i,
        /\bwhat\s*(containers?|docker).*(running)?\b/i
      ],
      description: 'List Docker containers',
      examples: ['list containers', 'docker ps', 'show running containers'],
      handler: async () => {
        const response = await this.apiCall('/api/execute', 'POST', {
          type: 'docker-list',
          description: 'List Docker containers'
        });
        return {
          success: response.success,
          action: 'docker_list',
          message: response.success 
            ? `Docker Containers:\n${JSON.stringify(response.result?.data || 'No containers', null, 2)}`
            : `Could not list containers: ${response.error}`,
          data: response,
          suggestedFollowUp: ['run a container', 'pull an image']
        };
      }
    });

    this.addHandler({
      intent: 'docker_run',
      patterns: [
        /\b(run|start|deploy|launch)\s*(a\s*)?(docker\s*)?(container|image)\s*(.+)?/i,
        /\bdocker\s*run\s+(.+)/i,
        /\bdeploy\s+(.+)\s*(container|image)?\b/i
      ],
      description: 'Run a Docker container',
      examples: ['run nginx container', 'deploy redis', 'docker run postgres'],
      handler: async (entities) => {
        const image = entities.image || entities.text || 'nginx';
        const response = await this.apiCall('/api/tasks', 'POST', {
          type: 'docker-run',
          description: `Run container: ${image}`,
          payload: { image, name: entities.name }
        });
        return {
          success: response.success,
          action: 'docker_run',
          message: response.success
            ? `✅ Container deployment task submitted for: ${image}\nTask ID: ${response.taskId}`
            : `❌ Failed: ${response.error}`,
          data: response,
          suggestedFollowUp: ['check task status', 'list containers']
        };
      }
    });

    this.addHandler({
      intent: 'docker_stop',
      patterns: [
        /\b(stop|kill|remove)\s*(the\s*)?(docker\s*)?(container)\s*(.+)?/i,
        /\bdocker\s*(stop|kill|rm)\s+(.+)/i
      ],
      description: 'Stop a Docker container',
      examples: ['stop nginx container', 'docker stop myapp'],
      handler: async (entities) => {
        const container = entities.container || entities.text;
        if (!container) {
          return { success: false, action: 'docker_stop', message: 'Please specify which container to stop' };
        }
        const response = await this.apiCall('/api/tasks', 'POST', {
          type: 'docker-stop',
          description: `Stop container: ${container}`,
          payload: { containerName: container }
        });
        return {
          success: response.success,
          action: 'docker_stop',
          message: response.success
            ? `✅ Stop task submitted for: ${container}`
            : `❌ Failed: ${response.error}`,
          data: response
        };
      }
    });

    // ============ TERRAFORM COMMANDS ============
    this.addHandler({
      intent: 'terraform_status',
      patterns: [
        /\bterraform\s*(status|version|check)\b/i,
        /\b(is\s*)?terraform\s*(installed|ready|available)\b/i
      ],
      description: 'Check Terraform status',
      examples: ['terraform status', 'is terraform installed?'],
      handler: async () => {
        const response = await this.apiCall('/api/terraform/status');
        return {
          success: true,
          action: 'terraform_status',
          message: response.installed
            ? `✅ Terraform v${response.version} is installed\nWorking directory: ${response.workingDir}`
            : `❌ Terraform is not installed`,
          data: response,
          suggestedFollowUp: ['terraform init', 'terraform plan']
        };
      }
    });

    this.addHandler({
      intent: 'terraform_init',
      patterns: [
        /\bterraform\s*init(ialize)?\b/i,
        /\binit(ialize)?\s*terraform\b/i
      ],
      description: 'Initialize Terraform',
      examples: ['terraform init', 'initialize terraform'],
      handler: async () => {
        const response = await this.apiCall('/api/terraform/init', 'POST', {});
        return {
          success: response.success,
          action: 'terraform_init',
          message: response.success
            ? `✅ Terraform initialized successfully!\n\`\`\`\n${response.output?.substring(0, 500)}...\n\`\`\``
            : `❌ Init failed: ${response.output}`,
          data: response,
          suggestedFollowUp: ['terraform plan', 'terraform validate']
        };
      }
    });

    this.addHandler({
      intent: 'terraform_plan',
      patterns: [
        /\bterraform\s*plan\b/i,
        /\bplan\s*(the\s*)?infrastructure\b/i,
        /\bwhat.*terraform.*change\b/i
      ],
      description: 'Run Terraform plan',
      examples: ['terraform plan', 'plan infrastructure changes'],
      handler: async () => {
        const response = await this.apiCall('/api/terraform/plan', 'POST', {});
        return {
          success: response.success,
          action: 'terraform_plan',
          message: response.success
            ? `✅ Terraform Plan:\n` +
              `• Create: ${response.resourceChanges?.create || 0}\n` +
              `• Update: ${response.resourceChanges?.update || 0}\n` +
              `• Delete: ${response.resourceChanges?.delete || 0}\n` +
              `\n${response.hasChanges ? '⚠️ Changes detected!' : '✅ No changes needed'}`
            : `❌ Plan failed: ${response.planOutput}`,
          data: response,
          suggestedFollowUp: response.hasChanges ? ['terraform apply', 'show terraform state'] : ['terraform status']
        };
      }
    });

    this.addHandler({
      intent: 'terraform_apply',
      patterns: [
        /\bterraform\s*apply\b/i,
        /\bapply\s*(the\s*)?(terraform\s*)?(changes?|infrastructure)\b/i
      ],
      description: 'Apply Terraform changes',
      examples: ['terraform apply', 'apply infrastructure changes'],
      handler: async (entities) => {
        if (!entities.confirmed) {
          return {
            success: false,
            action: 'terraform_apply',
            message: `⚠️ **Terraform Apply requires confirmation!**\n\nThis will make real infrastructure changes. Say:\n"terraform apply confirmed" or "yes, apply terraform"`,
            suggestedFollowUp: ['terraform plan', 'terraform apply confirmed']
          };
        }
        const response = await this.apiCall('/api/terraform/apply', 'POST', { autoApprove: true });
        return {
          success: response.success,
          action: 'terraform_apply',
          message: response.success
            ? `✅ Terraform apply completed!\n\`\`\`\n${response.output?.substring(0, 500)}...\n\`\`\``
            : `❌ Apply failed: ${response.output}`,
          data: response,
          suggestedFollowUp: ['terraform state', 'terraform outputs']
        };
      }
    });

    this.addHandler({
      intent: 'terraform_state',
      patterns: [
        /\bterraform\s*state\b/i,
        /\bshow\s*(terraform\s*)?(state|resources)\b/i,
        /\bwhat.*terraform\s*manag(e|ing)\b/i
      ],
      description: 'Show Terraform state',
      examples: ['terraform state', 'show terraform resources'],
      handler: async () => {
        const response = await this.apiCall('/api/terraform/resources');
        return {
          success: response.success,
          action: 'terraform_state',
          message: response.success
            ? `Terraform Resources:\n${(response.resources || []).map((r: string) => `• ${r}`).join('\n') || 'No resources'}`
            : `❌ Could not get state`,
          data: response,
          suggestedFollowUp: ['terraform plan', 'terraform outputs']
        };
      }
    });

    // ============ KNOWLEDGE COMMANDS ============
    this.addHandler({
      intent: 'knowledge_add',
      patterns: [
        /\b(add|store|save|remember)\s*(to\s*)?(knowledge|memory|kb)\s*:\s*(.+)/i,
        /\bremember\s*(this|that)?\s*:\s*(.+)/i,
        /\blearn\s*:\s*(.+)/i
      ],
      description: 'Add to knowledge base',
      examples: ['add to knowledge: Redis runs on port 6379', 'remember: API key is xyz'],
      handler: async (entities) => {
        const content = entities.content || entities.text;
        if (!content) {
          return { success: false, action: 'knowledge_add', message: 'Please provide content to add' };
        }
        const response = await this.apiCall('/api/knowledge/add', 'POST', { content });
        return {
          success: response.success,
          action: 'knowledge_add',
          message: response.success
            ? `✅ Added to knowledge base!\nDocument ID: ${response.id}`
            : `❌ Failed to add: ${response.error}`,
          data: response
        };
      }
    });

    this.addHandler({
      intent: 'knowledge_query',
      patterns: [
        /\b(ask|query|question)\s*(knowledge|kb|memory)\s*:\s*(.+)/i,
        /\bwhat\s+do\s+(you|we)\s+know\s+about\s+(.+)/i,
        /\bsearch\s*(knowledge|memory)\s*(for)?\s*:\s*(.+)/i
      ],
      description: 'Query knowledge base',
      examples: ['ask knowledge: how to deploy?', 'what do we know about redis?'],
      handler: async (entities) => {
        const question = entities.question || entities.text;
        if (!question) {
          return { success: false, action: 'knowledge_query', message: 'Please provide a question' };
        }
        const response = await this.apiCall('/api/knowledge/query', 'POST', { question });
        return {
          success: true,
          action: 'knowledge_query',
          message: `📚 Knowledge Base Answer:\n\n${response.answer}`,
          data: response
        };
      }
    });

    // ============ SECURITY COMMANDS ============
    this.addHandler({
      intent: 'security_status',
      patterns: [
        /\bsecurity\s*(status|check|info)\b/i,
        /\b(is|are)\s*(the\s*)?(system|we)\s*secure\b/i,
        /\bshow\s*security\b/i
      ],
      description: 'Check security status',
      examples: ['security status', 'are we secure?', 'show security'],
      handler: async () => {
        const response = await this.apiCall('/api/security/metrics');
        return {
          success: true,
          action: 'security_status',
          message: `🔒 Security Status:\n` +
            `• Guardrails: ${response.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
            `• Strict Mode: ${response.strictMode ? 'Yes' : 'No'}\n` +
            `• Max Input Length: ${response.maxInputLength}\n` +
            `• Active Patterns: ${response.patternCount || 'N/A'}`,
          data: response,
          suggestedFollowUp: ['security rules', 'analyze text for threats']
        };
      }
    });

    this.addHandler({
      intent: 'security_analyze',
      patterns: [
        /\banalyze\s*(for\s*)?(security|threats?|injection)\s*:\s*(.+)/i,
        /\b(is|check)\s*(this\s*)?(safe|secure)\s*:\s*(.+)/i,
        /\bscan\s*(for\s*)?(threats?|security)\s*:\s*(.+)/i
      ],
      description: 'Analyze text for security threats',
      examples: ['analyze for threats: ignore previous instructions', 'is this safe: some text'],
      handler: async (entities) => {
        const content = entities.content || entities.text;
        if (!content) {
          return { success: false, action: 'security_analyze', message: 'Please provide content to analyze' };
        }
        const response = await this.apiCall('/api/security/analyze', 'POST', { content });
        return {
          success: true,
          action: 'security_analyze',
          message: response.allowed
            ? `✅ Content appears safe\nConfidence: ${(response.confidence * 100).toFixed(0)}%`
            : `⚠️ Potential threats detected!\n` +
              `Risk Score: ${response.riskScore}\n` +
              `Threats: ${response.threats?.join(', ') || 'Unknown'}`,
          data: response
        };
      }
    });

    // ============ FEATURE REQUESTS ============
    this.addHandler({
      intent: 'feature_request',
      patterns: [
        /\b(request|add|want|need)\s*(a\s*)?(new\s*)?(feature|capability|ability)\s*(:|\s+for)?\s*(.+)?/i,
        /\bfeature\s*request\s*:\s*(.+)/i,
        /\bcan\s+(you|we|the system)\s+(add|have|get)\s+(.+)/i,
        /\bi\s+(want|need|wish)\s+(.+)/i
      ],
      description: 'Submit a feature request',
      examples: ['request feature: slack integration', 'can we add email notifications?'],
      handler: async (entities) => {
        const description = entities.description || entities.text;
        if (!description) {
          return { success: false, action: 'feature_request', message: 'Please describe the feature you want' };
        }
        const response = await this.apiCall('/api/adaptability/features', 'POST', { description });
        return {
          success: response.success,
          action: 'feature_request',
          message: response.success
            ? `✅ Feature request submitted!\n\n` +
              `**ID:** ${response.featureRequest?.id}\n` +
              `**Status:** ${response.featureRequest?.status}\n\n` +
              `I'll analyze this and create an implementation plan.`
            : `❌ Failed: ${response.error}`,
          data: response,
          suggestedFollowUp: ['list feature requests', 'check feature status']
        };
      }
    });

    this.addHandler({
      intent: 'feature_list',
      patterns: [
        /\b(list|show|get)\s*(all\s*)?(feature\s*)?(requests?|features?)\b/i,
        /\bwhat\s*(features?|requests?)\s*(are\s*)?(pending|open|there)\b/i
      ],
      description: 'List feature requests',
      examples: ['list feature requests', 'show pending features'],
      handler: async () => {
        const response = await this.apiCall('/api/adaptability/features');
        const features = response.featureRequests || [];
        return {
          success: true,
          action: 'feature_list',
          message: features.length > 0
            ? `Feature Requests (${features.length}):\n\n` +
              features.slice(0, 5).map((f: any) => 
                `• **${f.id}** [${f.status}]\n  ${f.description.substring(0, 50)}...`
              ).join('\n\n')
            : 'No feature requests yet. Submit one with "request feature: your idea"',
          data: response,
          suggestedFollowUp: ['request a new feature', 'get feature suggestions']
        };
      }
    });

    // ============ CONFIG COMMANDS ============
    this.addHandler({
      intent: 'config_list',
      patterns: [
        /\b(show|list|get)\s*(the\s*)?(config|configuration|settings)\b/i,
        /\bwhat.*settings\b/i,
        /\bconfig(uration)?\s*(list|show)\b/i
      ],
      description: 'List configuration options',
      examples: ['show config', 'list settings', 'what are the settings?'],
      handler: async () => {
        const response = await this.apiCall('/api/adaptability/config');
        const configs = response.config || [];
        return {
          success: true,
          action: 'config_list',
          message: `Configuration:\n\n` +
            configs.map((c: any) => 
              `• **${c.key}**: ${c.value} ${c.editable ? '✏️' : '🔒'}\n  _${c.description}_`
            ).join('\n\n'),
          data: response,
          suggestedFollowUp: ['change a config value']
        };
      }
    });

    this.addHandler({
      intent: 'config_set',
      patterns: [
        /\bset\s+(config|setting)\s+(\w+)\s*(to|=)\s*(.+)/i,
        /\bchange\s+(\w+)\s*(to|=)\s*(.+)/i,
        /\bconfig\s+set\s+(\w+)\s*=?\s*(.+)/i
      ],
      description: 'Update a configuration value',
      examples: ['set config rate_limit to 200', 'change max_concurrent_tasks to 100'],
      handler: async (entities) => {
        const key = entities.key;
        const value = entities.value;
        if (!key || value === undefined) {
          return { success: false, action: 'config_set', message: 'Please specify: set config KEY to VALUE' };
        }
        const response = await this.apiCall(`/api/adaptability/config/${key}`, 'PATCH', { value });
        return {
          success: response.success,
          action: 'config_set',
          message: response.success
            ? `✅ Config updated: ${key} = ${value}` +
              (response.requiresRestart ? '\n⚠️ Restart required for this change' : '')
            : `❌ Failed to update config`,
          data: response
        };
      }
    });

    // ============ LEARNING/SUGGESTIONS ============
    this.addHandler({
      intent: 'learning_stats',
      patterns: [
        /\b(learning|training)\s*(stats|statistics|progress)\b/i,
        /\bhow\s*(much|well).*learn(ed|ing)\b/i,
        /\bshow\s*(learning|training)\b/i
      ],
      description: 'Show learning statistics',
      examples: ['learning stats', 'how much have you learned?'],
      handler: async () => {
        const response = await this.apiCall('/api/adaptability/stats');
        return {
          success: true,
          action: 'learning_stats',
          message: `📊 Learning Statistics:\n\n` +
            `• Total Interactions: ${response.total}\n` +
            `• Success Rate: ${(response.successRate * 100).toFixed(1)}%\n` +
            `• Average Rating: ${response.avgRating.toFixed(1)}/5\n` +
            `• Trend: ${response.recentTrend === 'improving' ? '📈 Improving' : response.recentTrend === 'declining' ? '📉 Declining' : '➡️ Stable'}`,
          data: response
        };
      }
    });

    this.addHandler({
      intent: 'learning_suggest',
      patterns: [
        /\b(suggest|recommend)\s*(features?|improvements?|ideas?)\b/i,
        /\bwhat\s*(should|could)\s*(i|we)\s*(add|improve|do)\b/i,
        /\bgive\s*(me\s*)?(suggestions?|ideas?)\b/i
      ],
      description: 'Get feature suggestions',
      examples: ['suggest features', 'what should we add?', 'give me ideas'],
      handler: async () => {
        const response = await this.apiCall('/api/adaptability/suggestions');
        return {
          success: true,
          action: 'learning_suggest',
          message: `💡 Feature Suggestions:\n\n` +
            (response.suggestions || []).map((s: string, i: number) => `${i + 1}. ${s}`).join('\n'),
          data: response,
          suggestedFollowUp: ['request one of these features']
        };
      }
    });

    // ============ EXTENSIONS - EXTERNAL SERVICE INTEGRATIONS ============
    this.addHandler({
      intent: 'extension_list',
      patterns: [
        /\b(list|show|get)\s*(all\s*)?(extensions?|integrations?|connections?|services?)\b/i,
        /\bwhat\s*(extensions?|integrations?|services?)\s*(are\s*)?(available|there)\b/i,
        /\bconnect(ions)?\b/i
      ],
      description: 'List available extensions and integrations',
      examples: ['list extensions', 'show integrations', 'what services are available?'],
      handler: async () => {
        const response = await this.apiCall('/api/extensions');
        const extensions = response.extensions || [];
        
        const enabled = extensions.filter((e: any) => e.enabled);
        const available = extensions.filter((e: any) => !e.enabled);
        
        return {
          success: true,
          action: 'extension_list',
          message: `**🔌 Extensions**\n\n` +
            `**Enabled (${enabled.length}):**\n` +
            (enabled.length > 0 
              ? enabled.map((e: any) => `${e.icon} **${e.name}** - ${e.description}`).join('\n')
              : '_None enabled yet_') +
            `\n\n**Available (${available.length}):**\n` +
            available.slice(0, 10).map((e: any) => 
              `${e.icon} **${e.name}** ${e.configured ? '✅' : '⚙️'}\n   ${e.capabilities?.slice(0, 3).join(', ')}...`
            ).join('\n'),
          data: response,
          suggestedFollowUp: ['connect to github', 'enable cloudflare', 'configure slack']
        };
      }
    });

    this.addHandler({
      intent: 'extension_configure',
      patterns: [
        /\b(configure|setup|connect|link)\s*(to\s*)?(github|cloudflare|zapier|google|xai|grok|claude|openai|slack|discord|notion|aws|stripe)\b/i,
        /\b(github|cloudflare|zapier|google|xai|grok|claude|openai|slack|discord|notion)\s*(setup|config|connect)\b/i
      ],
      description: 'Configure an extension',
      examples: ['connect to github', 'setup cloudflare', 'configure slack'],
      handler: async (entities) => {
        const extName = entities.extension || entities.text?.match(/(github|cloudflare|zapier|google|xai|grok|claude|openai|slack|discord|notion|aws|stripe)/i)?.[1]?.toLowerCase();
        
        if (!extName) {
          return {
            success: false,
            action: 'extension_configure',
            message: 'Please specify which extension to configure (e.g., "connect to github")'
          };
        }

        const response = await this.apiCall(`/api/extensions/${extName}`);
        const ext = response.extension;
        
        if (!ext) {
          return { success: false, action: 'extension_configure', message: `Extension "${extName}" not found` };
        }

        return {
          success: true,
          action: 'extension_configure',
          message: `**${ext.icon} Configure ${ext.name}**\n\n` +
            `To connect ${ext.name}, you need to provide:\n\n` +
            ext.requiredCredentials.map((c: string) => `• \`${c}\``).join('\n') +
            `\n\n**Set credentials with:**\n` +
            `"set extension ${extName} ${ext.requiredCredentials[0]}=your_key_here"\n\n` +
            `**Or use the API:**\n` +
            `\`POST /api/extensions/${extName}/configure\``,
          data: ext,
          suggestedFollowUp: [`enable ${extName}`, 'list extensions']
        };
      }
    });

    this.addHandler({
      intent: 'extension_enable',
      patterns: [
        /\b(enable|activate|turn on)\s*(the\s*)?(github|cloudflare|zapier|google|xai|grok|claude|openai|slack|discord|notion|aws|stripe)\s*(extension|integration)?\b/i
      ],
      description: 'Enable an extension',
      examples: ['enable github', 'activate cloudflare', 'turn on slack'],
      handler: async (entities) => {
        const extName = entities.extension || entities.text?.match(/(github|cloudflare|zapier|google|xai|grok|claude|openai|slack|discord|notion|aws|stripe)/i)?.[1]?.toLowerCase();
        
        if (!extName) {
          return { success: false, action: 'extension_enable', message: 'Please specify which extension to enable' };
        }

        const response = await this.apiCall(`/api/extensions/${extName}/enable`, 'POST');
        
        return {
          success: response.success,
          action: 'extension_enable',
          message: response.success
            ? `✅ ${extName} extension is now enabled!`
            : `❌ Failed to enable: ${response.error}`,
          suggestedFollowUp: [`use ${extName}`, 'list extensions']
        };
      }
    });

    // ============ GITHUB COMMANDS ============
    this.addHandler({
      intent: 'github_repos',
      patterns: [
        /\b(list|show|get)\s*(my\s*)?(github\s*)?(repos?|repositories)\b/i,
        /\bgithub\s+(list\s+)?repos?\b/i,
        /\bcreate\s*(a\s*)?(github\s*)?(repo|repository)\s*:?\s*(.+)?/i
      ],
      description: 'Manage GitHub repositories',
      examples: ['list my repos', 'github repos', 'create repo my-project'],
      handler: async (entities) => {
        const isCreate = /create/i.test(entities.text);
        
        if (isCreate) {
          const nameMatch = entities.text?.match(/(?:repo|repository)\s*:?\s*(\S+)/i);
          const name = nameMatch?.[1];
          
          if (!name) {
            return { success: false, action: 'github_repos', message: 'Please specify repo name: "create repo my-project"' };
          }

          const response = await this.apiCall('/api/extensions/github/execute', 'POST', {
            action: 'create-repo',
            params: { name }
          });
          
          return {
            success: response.success,
            action: 'github_repos',
            message: response.success
              ? `✅ Created repository: ${response.data?.html_url || name}`
              : `❌ Failed: ${response.error}`,
            data: response.data
          };
        }

        // List repos
        const response = await this.apiCall('/api/extensions/github/execute', 'POST', {
          action: 'list-repos',
          params: {}
        });

        const repos = response.data || [];
        return {
          success: response.success,
          action: 'github_repos',
          message: response.success
            ? `**GitHub Repositories (${repos.length}):**\n\n` +
              repos.slice(0, 10).map((r: any) => `• **${r.name}** ${r.private ? '🔒' : '🌐'}\n  ${r.html_url}`).join('\n')
            : `❌ Failed: ${response.error}. Is GitHub connected?`,
          suggestedFollowUp: ['create repo new-project', 'github issues']
        };
      }
    });

    this.addHandler({
      intent: 'github_issues',
      patterns: [
        /\b(list|show|get)\s*(github\s*)?(issues?)\s*(for|in|on)?\s*(\S+\/\S+)?/i,
        /\bcreate\s*(github\s*)?(issue)\s*(on|in|for)?\s*(\S+\/\S+)?\s*:?\s*(.+)?/i,
        /\bgithub\s+issues?\b/i
      ],
      description: 'Manage GitHub issues',
      examples: ['list issues for owner/repo', 'create issue on owner/repo: title'],
      handler: async (entities) => {
        const repoMatch = entities.text?.match(/(\w+\/\w+)/);
        const repo = repoMatch?.[1];
        const isCreate = /create/i.test(entities.text);

        if (isCreate) {
          if (!repo) {
            return { success: false, action: 'github_issues', message: 'Please specify repo: "create issue on owner/repo: title"' };
          }
          
          const titleMatch = entities.text?.match(/:\s*(.+)/);
          const [owner, repoName] = repo.split('/');
          
          const response = await this.apiCall('/api/extensions/github/execute', 'POST', {
            action: 'create-issue',
            params: { owner, repo: repoName, title: titleMatch?.[1] || 'New Issue' }
          });

          return {
            success: response.success,
            action: 'github_issues',
            message: response.success
              ? `✅ Issue created: ${response.data?.html_url}`
              : `❌ Failed: ${response.error}`
          };
        }

        if (!repo) {
          return { success: false, action: 'github_issues', message: 'Please specify repo: "list issues for owner/repo"' };
        }

        const [owner, repoName] = repo.split('/');
        const response = await this.apiCall('/api/extensions/github/execute', 'POST', {
          action: 'list-issues',
          params: { owner, repo: repoName }
        });

        const issues = response.data || [];
        return {
          success: response.success,
          action: 'github_issues',
          message: response.success
            ? `**Issues for ${repo} (${issues.length}):**\n\n` +
              issues.slice(0, 10).map((i: any) => `• #${i.number} ${i.title}`).join('\n')
            : `❌ Failed: ${response.error}`
        };
      }
    });

    // ============ CLOUDFLARE COMMANDS ============
    this.addHandler({
      intent: 'cloudflare_dns',
      patterns: [
        /\b(list|show|get)\s*(cloudflare\s*)?(dns|domains?|zones?)\b/i,
        /\b(add|create)\s*(cloudflare\s*)?(dns)\s*(record)?\s*:?\s*(.+)?/i,
        /\bcloudflare\s+dns\b/i
      ],
      description: 'Manage Cloudflare DNS',
      examples: ['list cloudflare dns', 'cloudflare zones'],
      handler: async (entities) => {
        const response = await this.apiCall('/api/extensions/cloudflare/execute', 'POST', {
          action: 'list-zones',
          params: {}
        });

        const zones = response.data?.result || [];
        return {
          success: response.success,
          action: 'cloudflare_dns',
          message: response.success
            ? `**Cloudflare Zones (${zones.length}):**\n\n` +
              zones.slice(0, 10).map((z: any) => `• **${z.name}** - ${z.status}`).join('\n')
            : `❌ Failed: ${response.error}. Is Cloudflare connected?`,
          suggestedFollowUp: ['deploy cloudflare worker', 'cloudflare ai gateway']
        };
      }
    });

    // ============ AI PROVIDER COMMANDS ============
    this.addHandler({
      intent: 'use_claude',
      patterns: [
        /\b(ask|use|query)\s*claude\s*:?\s*(.+)/i,
        /\bclaude\s*:\s*(.+)/i
      ],
      description: 'Send a query to Claude (Anthropic)',
      examples: ['ask claude: explain quantum computing', 'claude: write a poem'],
      handler: async (entities) => {
        const queryMatch = entities.text?.match(/(?:claude|ask\s*claude)\s*:?\s*(.+)/i);
        const query = queryMatch?.[1];
        
        if (!query) {
          return { success: false, action: 'use_claude', message: 'Please provide a query: "ask claude: your question"' };
        }

        const response = await this.apiCall('/api/extensions/claude/execute', 'POST', {
          action: 'chat',
          params: {
            messages: [{ role: 'user', content: query }]
          }
        });

        return {
          success: response.success,
          action: 'use_claude',
          message: response.success
            ? `**Claude's Response:**\n\n${response.data?.content?.[0]?.text || response.data}`
            : `❌ Claude not available: ${response.error}. Configure with "connect to claude"`
        };
      }
    });

    this.addHandler({
      intent: 'use_grok',
      patterns: [
        /\b(ask|use|query)\s*(grok|xai)\s*:?\s*(.+)/i,
        /\bgrok\s*:\s*(.+)/i,
        /\bxai\s*:\s*(.+)/i
      ],
      description: 'Send a query to Grok (xAI)',
      examples: ['ask grok: what happened today?', 'grok: explain this'],
      handler: async (entities) => {
        const queryMatch = entities.text?.match(/(?:grok|xai|ask\s*(?:grok|xai))\s*:?\s*(.+)/i);
        const query = queryMatch?.[1];
        
        if (!query) {
          return { success: false, action: 'use_grok', message: 'Please provide a query: "ask grok: your question"' };
        }

        const response = await this.apiCall('/api/extensions/xai/execute', 'POST', {
          action: 'chat',
          params: {
            messages: [{ role: 'user', content: query }]
          }
        });

        return {
          success: response.success,
          action: 'use_grok',
          message: response.success
            ? `**Grok's Response:**\n\n${response.data?.choices?.[0]?.message?.content || response.data}`
            : `❌ Grok not available: ${response.error}. Configure with "connect to xai"`
        };
      }
    });

    // ============ GOOGLE COMMANDS ============
    this.addHandler({
      intent: 'google_search',
      patterns: [
        /\b(google|search)\s*(the\s*)?(web\s*)?(for)?\s*:?\s*(.+)/i,
        /\bsearch\s*:\s*(.+)/i
      ],
      description: 'Search the web via Google',
      examples: ['google: best AI tools 2024', 'search for: docker tutorials'],
      handler: async (entities) => {
        const queryMatch = entities.text?.match(/(?:google|search)(?:\s*(?:the\s*)?(?:web\s*)?(?:for)?)?\s*:?\s*(.+)/i);
        const query = queryMatch?.[1];
        
        if (!query) {
          return { success: false, action: 'google_search', message: 'Please provide search terms: "google: your query"' };
        }

        const response = await this.apiCall('/api/extensions/google/execute', 'POST', {
          action: 'web-search',
          params: { query }
        });

        const results = response.data?.items || [];
        return {
          success: response.success,
          action: 'google_search',
          message: response.success
            ? `**Search Results for "${query}":**\n\n` +
              results.slice(0, 5).map((r: any, i: number) => 
                `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.link}`
              ).join('\n\n')
            : `❌ Search failed: ${response.error}. Configure with "connect to google"`
        };
      }
    });

    // ============ COMMUNICATION COMMANDS ============
    this.addHandler({
      intent: 'slack_send',
      patterns: [
        /\b(send|post)\s*(to\s*)?(slack)\s*(message)?\s*:?\s*(.+)?/i,
        /\bslack\s*(send|post|message)\s*:?\s*(.+)?/i,
        /\bslack\s*#(\w+)\s*:?\s*(.+)/i
      ],
      description: 'Send a message to Slack',
      examples: ['send to slack: Hello team!', 'slack #general: Meeting at 3pm'],
      handler: async (entities) => {
        const channelMatch = entities.text?.match(/#(\w+)/);
        const messageMatch = entities.text?.match(/(?:slack|send\s*to\s*slack).*?:?\s*(.+)/i);
        
        const channel = channelMatch?.[1] || 'general';
        const message = messageMatch?.[1]?.replace(/#\w+\s*/, '').trim();
        
        if (!message) {
          return { success: false, action: 'slack_send', message: 'Please provide a message: "slack #channel: your message"' };
        }

        const response = await this.apiCall('/api/extensions/slack/execute', 'POST', {
          action: 'send-message',
          params: { channel, text: message }
        });

        return {
          success: response.success,
          action: 'slack_send',
          message: response.success
            ? `✅ Message sent to #${channel}`
            : `❌ Failed: ${response.error}. Configure with "connect to slack"`
        };
      }
    });

    this.addHandler({
      intent: 'notion_create',
      patterns: [
        /\b(create|add)\s*(notion\s*)?(page|doc|document)\s*:?\s*(.+)?/i,
        /\bnotion\s*(create|new)\s*(page)?\s*:?\s*(.+)?/i
      ],
      description: 'Create a Notion page',
      examples: ['create notion page: Meeting Notes', 'notion create: Project Plan'],
      handler: async (entities) => {
        const titleMatch = entities.text?.match(/(?:page|doc|document|notion.*?(?:create|new))\s*:?\s*(.+)/i);
        const title = titleMatch?.[1];
        
        if (!title) {
          return { success: false, action: 'notion_create', message: 'Please provide a title: "create notion page: Your Title"' };
        }

        const response = await this.apiCall('/api/extensions/notion/execute', 'POST', {
          action: 'create-page',
          params: {
            properties: { title: { title: [{ text: { content: title } }] } }
          }
        });

        return {
          success: response.success,
          action: 'notion_create',
          message: response.success
            ? `✅ Notion page created: ${response.data?.url || title}`
            : `❌ Failed: ${response.error}. Configure with "connect to notion"`
        };
      }
    });

    // ============ ZAPIER AUTOMATION ============
    this.addHandler({
      intent: 'zapier_trigger',
      patterns: [
        /\b(trigger|run|execute)\s*(zapier\s*)?(webhook|zap|automation)\s*:?\s*(.+)?/i,
        /\bzapier\s*(trigger|send|webhook)\s*:?\s*(.+)?/i
      ],
      description: 'Trigger a Zapier webhook',
      examples: ['trigger zapier webhook: new lead', 'zapier send: user signup'],
      handler: async (entities) => {
        const dataMatch = entities.text?.match(/(?:webhook|zap|automation|trigger|send)\s*:?\s*(.+)/i);
        const data = dataMatch?.[1];

        const response = await this.apiCall('/api/extensions/zapier/execute', 'POST', {
          action: 'trigger-webhook',
          params: { data: { message: data, timestamp: new Date().toISOString() } }
        });

        return {
          success: response.success,
          action: 'zapier_trigger',
          message: response.success
            ? `✅ Zapier webhook triggered!`
            : `❌ Failed: ${response.error}. Configure with "connect to zapier"`
        };
      }
    });

    // ============ HELP ============
    this.addHandler({
      intent: 'help',
      patterns: [
        /\bhelp\b/i,
        /\bwhat\s+can\s+(you|i)\s+do\b/i,
        /\bcommands?\b/i,
        /\bhow\s+do\s+i\b/i
      ],
      description: 'Show help and available commands',
      examples: ['help', 'what can you do?', 'commands'],
      handler: async () => {
        const categories = [
          { name: '🤖 Create Agents', commands: [
            'create an agent to monitor stock prices',
            'build a sentiment analysis agent', 
            'make a Fortigate expert agent',
            'list my agents',
            'agent status agent-123'
          ]},
          { name: '🔌 Extensions', commands: [
            'list extensions',
            'connect to github',
            'connect to cloudflare',
            'enable slack',
            'list my repos',
            'ask claude: question',
            'ask grok: question'
          ]},
          { name: '🐙 GitHub', commands: ['list repos', 'create repo my-project', 'github issues'] },
          { name: '☁️ Cloudflare', commands: ['cloudflare dns', 'cloudflare zones'] },
          { name: '💬 Communication', commands: ['slack #general: message', 'notion create: page title'] },
          { name: '🖥️ System', commands: ['system status', 'show capabilities', 'list agents'] },
          { name: '🐳 Docker', commands: ['list containers', 'run nginx container'] },
          { name: '🏗️ Terraform', commands: ['terraform status', 'terraform plan', 'terraform apply'] },
          { name: '📚 Knowledge', commands: ['add to knowledge: info', 'ask knowledge: question'] },
          { name: '🔒 Security', commands: ['security status', 'analyze for threats: text'] },
          { name: '⚙️ Config', commands: ['show config', 'set config KEY to VALUE'] }
        ];
        
        return {
          success: true,
          action: 'help',
          message: `# 🤖 System Management Commands\n\n` +
            categories.map(c => `**${c.name}**\n${c.commands.map(cmd => `• \`${cmd}\``).join('\n')}`).join('\n\n') +
            `\n\n_Just type naturally - I'll understand!_`
        };
      }
    });

    // ============ GENERAL CHAT (fallback) ============
    this.addHandler({
      intent: 'chat',
      patterns: [/.*/], // Matches everything as fallback
      description: 'General chat with AI',
      examples: ['hello', 'explain docker'],
      handler: async (entities, context) => {
        const response = await this.apiCall('/api/chat', 'POST', {
          messages: [
            { role: 'system', content: 'You are a helpful AI assistant that helps manage infrastructure and systems. Be concise but helpful.' },
            { role: 'user', content: entities.text }
          ]
        });
        return {
          success: true,
          action: 'chat',
          message: response.choices?.[0]?.message?.content || 'I understood your message but couldn\'t generate a response.',
          suggestedFollowUp: ['help', 'system status']
        };
      }
    });
  }

  /**
   * Add a command handler
   */
  private addHandler(handler: CommandHandler): void {
    this.handlers.set(handler.intent, handler);
  }

  /**
   * Parse natural language command
   */
  async parseCommand(text: string): Promise<ParsedCommand> {
    const normalizedText = text.trim().toLowerCase();
    
    // Check for confirmation patterns
    const isConfirmation = /\b(yes|confirm|confirmed|approve|approved|do it|go ahead)\b/i.test(text);
    
    // Try to match against registered patterns
    for (const [intent, handler] of this.handlers) {
      if (intent === 'chat') continue; // Skip fallback
      
      for (const pattern of handler.patterns) {
        const match = text.match(pattern);
        if (match) {
          const entities = this.extractEntities(text, match, intent);
          if (isConfirmation) {
            entities.confirmed = true;
          }
          return {
            intent,
            confidence: 0.9,
            entities,
            originalText: text
          };
        }
      }
    }

    // Fallback to chat
    return {
      intent: 'chat',
      confidence: 0.5,
      entities: { text },
      originalText: text
    };
  }

  /**
   * Extract entities from matched command
   */
  private extractEntities(text: string, match: RegExpMatchArray, intent: CommandIntent): Record<string, any> {
    const entities: Record<string, any> = { text };

    // Extract based on intent
    switch (intent) {
      case 'docker_run':
      case 'docker_stop':
        // Extract image/container name
        const dockerMatch = text.match(/(?:run|deploy|start|stop|kill)\s+(?:a\s+)?(?:docker\s+)?(?:container\s+)?(?:image\s+)?(\S+)/i);
        if (dockerMatch) entities.image = entities.container = dockerMatch[1];
        break;

      case 'feature_request':
        const featureMatch = text.match(/(?:feature|capability|ability)(?:\s+request)?(?:\s*:?\s*for)?\s*:?\s*(.+)/i) ||
                           text.match(/(?:can\s+(?:you|we|the system)\s+(?:add|have|get))\s+(.+)/i) ||
                           text.match(/(?:i\s+(?:want|need|wish))\s+(.+)/i);
        if (featureMatch) entities.description = featureMatch[1].trim();
        break;

      case 'knowledge_add':
        const addMatch = text.match(/(?:add|store|save|remember|learn)\s*(?:to\s*)?(?:knowledge|memory|kb)?\s*:?\s*(.+)/i);
        if (addMatch) entities.content = addMatch[1].trim();
        break;

      case 'knowledge_query':
        const queryMatch = text.match(/(?:ask|query|search)\s*(?:knowledge|kb|memory)?\s*(?:for)?\s*:?\s*(.+)/i) ||
                          text.match(/what\s+do\s+(?:you|we)\s+know\s+about\s+(.+)/i);
        if (queryMatch) entities.question = queryMatch[1].trim();
        break;

      case 'security_analyze':
        const secMatch = text.match(/(?:analyze|check|scan|is\s+this\s+safe)\s*(?:for\s*)?(?:security|threats?)?\s*:?\s*(.+)/i);
        if (secMatch) entities.content = secMatch[1].trim();
        break;

      case 'config_set':
        const configMatch = text.match(/(?:set\s+config|change|config\s+set)\s+(\w+)\s*(?:to|=)\s*(.+)/i);
        if (configMatch) {
          entities.key = configMatch[1];
          entities.value = this.parseValue(configMatch[2].trim());
        }
        break;

      case 'submit_task':
        const taskMatch = text.match(/(?:task|do)\s*:\s*(.+)/i);
        if (taskMatch) entities.taskDescription = taskMatch[1].trim();
        break;
    }

    return entities;
  }

  /**
   * Parse a string value to appropriate type
   */
  private parseValue(str: string): any {
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (/^\d+$/.test(str)) return parseInt(str);
    if (/^\d+\.\d+$/.test(str)) return parseFloat(str);
    return str;
  }

  /**
   * Execute a command
   */
  async execute(text: string, context?: Partial<CommandContext>): Promise<CommandResult> {
    const sessionId = context?.sessionId || 'default';
    
    // Get or create conversation history
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    const history = this.conversationHistory.get(sessionId)!;
    
    // Parse the command
    const parsed = await this.parseCommand(text);
    
    // Get the handler
    const handler = this.handlers.get(parsed.intent);
    if (!handler) {
      return {
        success: false,
        action: 'unknown',
        message: 'I didn\'t understand that command. Try "help" to see what I can do.'
      };
    }

    // Execute the handler
    try {
      const result = await handler.handler(parsed.entities, {
        userId: context?.userId,
        sessionId,
        history
      });

      // Update history
      history.push(text);
      if (history.length > 10) history.shift();

      // Record learning
      await this.recordInteraction(text, result);

      return result;
    } catch (error) {
      console.error('Command execution error:', error);
      return {
        success: false,
        action: parsed.intent,
        message: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Make API call to the agent system
   */
  private async apiCall(path: string, method: string = 'GET', body?: any): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return await response.json();
    } catch (error) {
      console.error('API call failed:', error);
      return { success: false, error: 'API call failed' };
    }
  }

  /**
   * Record interaction for learning
   */
  private async recordInteraction(input: string, result: CommandResult): Promise<void> {
    try {
      await this.apiCall('/api/adaptability/learn', 'POST', {
        userRequest: input,
        systemResponse: result.message,
        outcome: result.success ? 'success' : 'failure'
      });
    } catch {
      // Learning is optional
    }
  }

  /**
   * Get available commands summary
   */
  getCommandsSummary(): { intent: string; description: string; examples: string[] }[] {
    const summary: { intent: string; description: string; examples: string[] }[] = [];
    
    for (const [intent, handler] of this.handlers) {
      if (intent !== 'chat' && intent !== 'unknown') {
        summary.push({
          intent,
          description: handler.description,
          examples: handler.examples
        });
      }
    }
    
    return summary;
  }
}

// Export singleton
export const commandInterpreter = new CommandInterpreter();
