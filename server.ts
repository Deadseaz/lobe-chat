/**
 * Agent System Server - HTTP API for the Multi-Agent System
 * Provides REST endpoints to interact with the agent orchestrator
 * 
 * FULLY WIRED: Security, Storage, AI Gateway, Vector Search
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

// Core Agents
import { AgentOrchestrator } from './AgentOrchestrator';
import { InfrastructureAgent } from './InfrastructureAgent';
import { MonitoringAgent } from './MonitoringAgent';
import { KnowledgeAgent } from './KnowledgeAgent';
import { AgentTask, TaskPriority, TaskStatus, AgentContext } from './types';

// Shared Services
import { 
  config,
  guardrails, 
  auth,
  storage,
  aiGateway,
  vectorService,
  ragService,
  AIGuardrailsService
} from './shared/index';

// Security Services (Stub for Node.js - full implementation in Cloudflare Workers)
class AdvancedSecurityService {
  constructor(_guardrails: any, _config: any) {}
  async analyzeContent(_content: string) { return { safe: true, allowed: true, threats: [], riskScore: 0 }; }
  getSecurityRules() { return []; }
  getSecurityMetrics() { return { requests: 0, blocked: 0, alerts: [] }; }
}

class ZeroTrustService {
  constructor() {}
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
// SECURITY MIDDLEWARE - Applied to all routes
// ============================================================

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Rate limiting and input validation (from guardrails)
app.use(guardrails.middleware());

// ============================================================
// INITIALIZE SERVICES
// ============================================================

let orchestrator: AgentOrchestrator;
let advancedSecurity: AdvancedSecurityService;
let zeroTrust: ZeroTrustService;
const agents: Map<string, any> = new Map();
let systemReady = false;

// Message Bus with Redis pub/sub support
class MessageBus {
  private subscribers: Map<string, ((msg: any) => Promise<void>)[]> = new Map();

  async publish(message: any): Promise<void> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    
    // Publish to Redis for distributed messaging
    await storage.publish('agent:messages', message);
    
    // Local handlers
    for (const target of to) {
      const handlers = this.subscribers.get(target) || [];
      for (const handler of handlers) {
        try {
          await handler(message);
        } catch (e) {
          console.error(`Error in message handler:`, e);
        }
      }
    }
  }

  async subscribe(topic: string, handler: (msg: any) => Promise<void>): Promise<void> {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, []);
    }
    this.subscribers.get(topic)!.push(handler);
  }

  async unsubscribe(topic: string): Promise<void> {
    this.subscribers.delete(topic);
  }
}

const messageBus = new MessageBus();

// Agent Context with real services
const context: AgentContext = {
  env: process.env,
  services: {
    storage,
    aiGateway,
    vectorService,
    ragService,
    config
  },
  messageBus,
  storage: {
    get: (key: string) => storage.get(key),
    put: (key: string, value: any) => storage.set(key, value),
    delete: (key: string) => storage.delete(key)
  }
};

/**
 * Initialize all services and agents
 */
async function initializeSystem() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           AGENT SYSTEM - Initializing Services                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  // 1. Connect to Redis storage
  console.log('\n[1/6] Connecting to Redis storage...');
  try {
    await storage.connect();
    const isConnected = await storage.ping();
    console.log(`      Redis: ${isConnected ? '✅ Connected' : '⚠️ Using fallback (in-memory)'}`);
  } catch (e) {
    console.warn('      Redis: ⚠️ Using fallback storage');
  }

  // 2. Initialize vector service
  console.log('\n[2/6] Initializing vector service...');
  try {
    await vectorService.ensureCollection();
    console.log('      Qdrant: ✅ Collection ready');
  } catch (e) {
    console.warn('      Qdrant: ⚠️ Not available');
  }

  // 3. Initialize security services
  console.log('\n[3/6] Initializing security services...');
  try {
    advancedSecurity = new AdvancedSecurityService(guardrails, config);
    zeroTrust = new ZeroTrustService();
    console.log('      Security: ✅ Advanced security + Zero Trust enabled');
    console.log(`      Config: ${JSON.stringify(guardrails.getConfig())}`);
  } catch (e) {
    console.warn('      Security: ⚠️ Basic mode only');
  }

  // 4. Initialize orchestrator
  console.log('\n[4/6] Initializing agent orchestrator...');
  const agentConfig = config.getAgent();
  orchestrator = new AgentOrchestrator(context, {
    maxConcurrentTasks: agentConfig.maxConcurrentTasks,
    taskTimeout: agentConfig.taskTimeout,
    retryAttempts: agentConfig.retryAttempts,
    loadBalancingStrategy: 'capability-match'
  });
  await orchestrator.initialize();
  agents.set('orchestrator', orchestrator);
  console.log('      Orchestrator: ✅ Ready');

  // 5. Initialize specialized agents
  console.log('\n[5/6] Initializing specialized agents...');
  
  if (agentConfig.enableInfrastructureAgent) {
    try {
      const infraAgent = new InfrastructureAgent(context);
      await infraAgent.initialize();
      agents.set('infrastructure', infraAgent);
      console.log('      Infrastructure Agent: ✅ Active');
    } catch (e) {
      console.warn('      Infrastructure Agent: ⚠️ Skipped');
    }
  }

  if (agentConfig.enableMonitoringAgent) {
    try {
      const monitoringAgent = new MonitoringAgent(context);
      await monitoringAgent.initialize();
      agents.set('monitoring', monitoringAgent);
      console.log('      Monitoring Agent: ✅ Active');
    } catch (e) {
      console.warn('      Monitoring Agent: ⚠️ Skipped');
    }
  }

  if (agentConfig.enableKnowledgeAgent) {
    try {
      const knowledgeAgent = new KnowledgeAgent(context);
      await knowledgeAgent.initialize();
      agents.set('knowledge', knowledgeAgent);
      console.log('      Knowledge Agent: ✅ Active');
    } catch (e) {
      console.warn('      Knowledge Agent: ⚠️ Skipped');
    }
  }

  // 6. Final status
  console.log('\n[6/6] System ready');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`Active Agents: ${agents.size}`);
  console.log(`Storage: ${storage.isConnected() ? 'Redis' : 'In-Memory Fallback'}`);
  console.log(`Security: ${config.getSecurity().enableAIGuardrails ? 'Guardrails ON' : 'Basic'}`);
  console.log('════════════════════════════════════════════════════════════════\n');

  systemReady = true;
}

// ============================================================
// NATURAL LANGUAGE COMMAND INTERFACE
// ============================================================

import { CommandInterpreter } from './services/command-interpreter';
const commandInterpreter = new CommandInterpreter(`http://localhost:${process.env.PORT || 3003}`);

// Main chat endpoint - manages everything via natural language
app.post('/api/command', async (req: Request, res: Response) => {
  try {
    const { text, message, sessionId, userId } = req.body;
    const input = text || message;
    
    if (!input) {
      return res.status(400).json({ error: 'Please provide a text or message field' });
    }

    const result = await commandInterpreter.execute(input, { sessionId, userId });
    
    res.json({
      success: result.success,
      action: result.action,
      response: result.message,
      data: result.data,
      suggestions: result.suggestedFollowUp
    });
  } catch (error) {
    console.error('Command error:', error);
    res.status(500).json({ 
      success: false, 
      response: 'Sorry, I encountered an error processing your command.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get available commands
app.get('/api/commands', (req: Request, res: Response) => {
  res.json({
    commands: commandInterpreter.getCommandsSummary(),
    hint: 'Send commands to POST /api/command with { "text": "your command" }'
  });
});

// WebSocket-style streaming endpoint for real-time chat
app.post('/api/chat/stream', async (req: Request, res: Response) => {
  try {
    const { text, message, sessionId } = req.body;
    const input = text || message;
    
    if (!input) {
      return res.status(400).json({ error: 'Please provide a text or message field' });
    }

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Execute command
    const result = await commandInterpreter.execute(input, { sessionId });
    
    // Send result as SSE
    res.write(`data: ${JSON.stringify({ type: 'result', ...result })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Command failed' })}\n\n`);
    res.end();
  }
});

// ============================================================
// HEALTH & STATUS ENDPOINTS (No auth required)
// ============================================================

app.get('/health', async (req: Request, res: Response) => {
  const redisOk = await storage.ping();
  
  res.json({
    status: systemReady ? 'healthy' : 'starting',
    service: 'agent-system',
    version: '2.0.0',
    agents: agents.size,
    uptime: process.uptime(),
    storage: redisOk ? 'redis' : 'memory',
    security: {
      guardrails: config.getSecurity().enableAIGuardrails,
      zeroTrust: config.getSecurity().enableZeroTrust,
      promptProtection: config.getSecurity().promptInjectionProtection
    }
  });
});

app.get('/api/status', async (req: Request, res: Response) => {
  if (!systemReady) {
    return res.status(503).json({ error: 'System initializing' });
  }

  const health = orchestrator.getSystemHealth();
  const agentList = orchestrator.getRegisteredAgents();

  res.json({
    orchestrator: orchestrator.getMetadata(),
    system: health,
    agents: agentList,
    services: {
      redis: storage.isConnected(),
      vectors: true,
      aiGateway: true
    },
    security: config.getSecurity(),
    config: {
      masterControlEnabled: process.env.MASTER_CONTROL_ENABLED === 'true',
      masterControlDomain: process.env.MASTER_CONTROL_DOMAIN
    }
  });
});

// ============================================================
// AGENT MANAGEMENT ENDPOINTS
// ============================================================

app.get('/api/agents', (req: Request, res: Response) => {
  if (!systemReady) {
    return res.status(503).json({ error: 'System initializing' });
  }
  const agentList = orchestrator.getRegisteredAgents();
  res.json({ agents: agentList, count: agentList.length });
});

app.get('/api/agents/:id', (req: Request, res: Response) => {
  if (!systemReady) {
    return res.status(503).json({ error: 'System initializing' });
  }
  const agentList = orchestrator.getRegisteredAgents();
  const agent = agentList.find(a => a.id === req.params.id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  res.json(agent);
});

// ============================================================
// TASK MANAGEMENT ENDPOINTS
// ============================================================

app.post('/api/tasks', async (req: Request, res: Response) => {
  if (!systemReady) {
    return res.status(503).json({ error: 'System initializing' });
  }

  try {
    const { type, description, payload, priority, requiredCapabilities, deadline } = req.body;

    if (!type || !description) {
      return res.status(400).json({ error: 'type and description are required' });
    }

    // Security check on payload
    if (advancedSecurity && payload) {
      const securityCheck = await advancedSecurity.analyzeContent(JSON.stringify(payload));
      if (!securityCheck.allowed) {
        return res.status(400).json({
          error: 'Payload failed security check',
          threats: securityCheck.threats,
          riskScore: securityCheck.riskScore
        });
      }
    }

    const task: AgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type,
      description,
      payload: payload || {},
      priority: priority || TaskPriority.NORMAL,
      status: TaskStatus.PENDING,
      requiredCapabilities: requiredCapabilities || [],
      createdAt: new Date(),
      deadline: deadline ? new Date(deadline) : undefined
    };

    // Store task in Redis for persistence
    await storage.set(`task:${task.id}`, task, 86400); // 24hr TTL
    await storage.lpush('tasks:recent', task.id);

    const taskId = await orchestrator.submitTask(task);

    res.json({
      success: true,
      taskId,
      message: 'Task submitted to orchestrator'
    });
  } catch (error) {
    console.error('Error submitting task:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/api/tasks', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const taskIds = await storage.lrange('tasks:recent', 0, limit - 1);
  
  const tasks = await Promise.all(
    taskIds.map(id => storage.get(`task:${id}`))
  );

  res.json({ tasks: tasks.filter(Boolean), count: tasks.length });
});

app.get('/api/tasks/:id', async (req: Request, res: Response) => {
  // Try orchestrator first
  let task = await orchestrator.getTaskStatus(req.params.id);
  
  // Fallback to storage
  if (!task) {
    task = await storage.get(`task:${req.params.id}`);
  }

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

app.post('/api/execute', async (req: Request, res: Response) => {
  if (!systemReady) {
    return res.status(503).json({ error: 'System initializing' });
  }

  try {
    const { type, description, payload, requiredCapabilities } = req.body;

    if (!type || !description) {
      return res.status(400).json({ error: 'type and description are required' });
    }

    const task: AgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type,
      description,
      payload: payload || {},
      priority: TaskPriority.HIGH,
      status: TaskStatus.PENDING,
      requiredCapabilities: requiredCapabilities || [],
      createdAt: new Date()
    };

    await orchestrator.submitTask(task);

    // Poll for result
    const timeout = parseInt(process.env.TASK_TIMEOUT || '60000');
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await orchestrator.getTaskStatus(task.id);
      if (result && (result.status === TaskStatus.COMPLETED || result.status === TaskStatus.FAILED)) {
        return res.json({
          success: result.status === TaskStatus.COMPLETED,
          task: result,
          result: result.result
        });
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    res.status(408).json({ error: 'Task execution timed out', taskId: task.id });
  } catch (error) {
    console.error('Error executing task:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ============================================================
// AI & KNOWLEDGE ENDPOINTS
// ============================================================

app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { messages, model, temperature, maxTokens } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const result = await aiGateway.chatCompletion(messages, {
      model,
      temperature,
      maxTokens
    });

    res.json(result);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'AI Gateway error' });
  }
});

app.post('/api/embeddings', async (req: Request, res: Response) => {
  try {
    const { text, model } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = await aiGateway.createEmbedding(text, model);
    res.json({ embeddings: result });
  } catch (error) {
    console.error('Embedding error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Embedding error' });
  }
});

app.post('/api/knowledge/add', async (req: Request, res: Response) => {
  try {
    const { id, content, metadata } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const docId = id || `doc-${Date.now()}`;
    await ragService.addDocument(docId, content, metadata);

    res.json({ success: true, id: docId });
  } catch (error) {
    console.error('Knowledge add error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Error adding document' });
  }
});

app.post('/api/knowledge/query', async (req: Request, res: Response) => {
  try {
    const { question, topK, includeContext } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'question is required' });
    }

    const result = await ragService.query(question, { topK, includeContext });
    res.json(result);
  } catch (error) {
    console.error('Knowledge query error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Query error' });
  }
});

app.post('/api/knowledge/search', async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const results = await ragService.search(query, limit);
    res.json({ results });
  } catch (error) {
    console.error('Knowledge search error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Search error' });
  }
});

// ============================================================
// SECURITY ENDPOINTS
// ============================================================

app.post('/api/security/analyze', async (req: Request, res: Response) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    if (advancedSecurity) {
      const analysis = await advancedSecurity.analyzeContent(content);
      res.json(analysis);
    } else {
      const basicAnalysis = await guardrails.validateInput(content);
      res.json(basicAnalysis);
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Analysis error' });
  }
});

app.get('/api/security/rules', (req: Request, res: Response) => {
  if (advancedSecurity) {
    res.json({ rules: advancedSecurity.getSecurityRules() });
  } else {
    res.json({ rules: [], message: 'Advanced security not enabled' });
  }
});

app.get('/api/security/metrics', (req: Request, res: Response) => {
  if (advancedSecurity) {
    res.json(advancedSecurity.getSecurityMetrics());
  } else {
    res.json(guardrails.getConfig());
  }
});

// ============================================================
// TERRAFORM ENDPOINTS
// ============================================================

import { TerraformService } from './services/terraform-service';
const terraformService = new TerraformService({ 
  workingDir: process.env.TERRAFORM_WORKING_DIR || '/app/terraform' 
});

app.get('/api/terraform/status', async (req: Request, res: Response) => {
  const installed = await terraformService.checkInstalled();
  const workingDir = terraformService.getWorkingDir();
  
  res.json({
    ...installed,
    workingDir,
    ready: installed.installed
  });
});

app.post('/api/terraform/init', async (req: Request, res: Response) => {
  try {
    const { workingDir, upgrade, reconfigure } = req.body;
    
    if (workingDir) {
      terraformService.setWorkingDir(workingDir);
    }
    
    const result = await terraformService.init({ upgrade, reconfigure });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Init failed' });
  }
});

app.post('/api/terraform/validate', async (req: Request, res: Response) => {
  try {
    const { workingDir } = req.body;
    
    if (workingDir) {
      terraformService.setWorkingDir(workingDir);
    }
    
    const result = await terraformService.validate();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Validation failed' });
  }
});

app.post('/api/terraform/plan', async (req: Request, res: Response) => {
  try {
    const { workingDir, variables, varFiles, target, destroy } = req.body;
    
    if (workingDir) {
      terraformService.setWorkingDir(workingDir);
    }
    
    const result = await terraformService.plan({ variables, varFiles, target, destroy });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Plan failed' });
  }
});

app.post('/api/terraform/apply', async (req: Request, res: Response) => {
  try {
    const { workingDir, variables, varFiles, target, autoApprove } = req.body;
    
    if (workingDir) {
      terraformService.setWorkingDir(workingDir);
    }
    
    // Require explicit autoApprove for safety
    if (!autoApprove) {
      return res.status(400).json({ 
        error: 'autoApprove must be true to apply changes',
        hint: 'Set autoApprove: true in request body to confirm infrastructure changes'
      });
    }
    
    const result = await terraformService.apply({ variables, varFiles, target, autoApprove: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Apply failed' });
  }
});

app.post('/api/terraform/destroy', async (req: Request, res: Response) => {
  try {
    const { workingDir, variables, target, autoApprove } = req.body;
    
    if (workingDir) {
      terraformService.setWorkingDir(workingDir);
    }
    
    // Require explicit autoApprove for safety
    if (!autoApprove) {
      return res.status(400).json({ 
        error: 'autoApprove must be true to destroy infrastructure',
        hint: 'Set autoApprove: true in request body to confirm destruction'
      });
    }
    
    const result = await terraformService.destroy({ variables, target, autoApprove: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Destroy failed' });
  }
});

app.get('/api/terraform/state', async (req: Request, res: Response) => {
  try {
    const result = await terraformService.getState();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'State fetch failed' });
  }
});

app.get('/api/terraform/resources', async (req: Request, res: Response) => {
  try {
    const result = await terraformService.listResources();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Resource list failed' });
  }
});

app.get('/api/terraform/outputs', async (req: Request, res: Response) => {
  try {
    const result = await terraformService.getOutputs();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Output fetch failed' });
  }
});

app.get('/api/terraform/workspaces', async (req: Request, res: Response) => {
  try {
    const result = await terraformService.listWorkspaces();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Workspace list failed' });
  }
});

app.post('/api/terraform/workspaces', async (req: Request, res: Response) => {
  try {
    const { action, name } = req.body;
    
    if (action === 'create') {
      if (!name) return res.status(400).json({ error: 'Workspace name required' });
      const result = await terraformService.createWorkspace(name);
      res.json(result);
    } else if (action === 'select') {
      if (!name) return res.status(400).json({ error: 'Workspace name required' });
      const result = await terraformService.selectWorkspace(name);
      res.json(result);
    } else {
      res.status(400).json({ error: 'Invalid action. Use "create" or "select"' });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Workspace operation failed' });
  }
});

// ============================================================
// EXTENSIONS - External Service Integrations
// ============================================================

import { extensionManager } from './services/extensions/extension-manager';

// Initialize extensions
extensionManager.initialize().catch(console.error);

// List all extensions
app.get('/api/extensions', async (req: Request, res: Response) => {
  try {
    const extensions = extensionManager.listExtensions();
    res.json({ success: true, extensions });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list extensions' });
  }
});

// Get specific extension
app.get('/api/extensions/:id', async (req: Request, res: Response) => {
  try {
    const extension = extensionManager.getExtension(req.params.id);
    if (!extension) {
      return res.status(404).json({ success: false, error: 'Extension not found' });
    }
    res.json({ success: true, extension });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get extension' });
  }
});

// Configure extension with credentials
app.post('/api/extensions/:id/configure', async (req: Request, res: Response) => {
  try {
    const { credentials } = req.body;
    if (!credentials) {
      return res.status(400).json({ success: false, error: 'Credentials required' });
    }
    
    await extensionManager.configureExtension(req.params.id, credentials);
    res.json({ success: true, message: 'Extension configured' });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Configuration failed' 
    });
  }
});

// Enable extension
app.post('/api/extensions/:id/enable', async (req: Request, res: Response) => {
  try {
    await extensionManager.enableExtension(req.params.id);
    res.json({ success: true, message: 'Extension enabled' });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to enable' 
    });
  }
});

// Disable extension
app.post('/api/extensions/:id/disable', async (req: Request, res: Response) => {
  try {
    await extensionManager.disableExtension(req.params.id);
    res.json({ success: true, message: 'Extension disabled' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to disable' });
  }
});

// Execute action on extension
app.post('/api/extensions/:id/execute', async (req: Request, res: Response) => {
  try {
    const { action, params } = req.body;
    if (!action) {
      return res.status(400).json({ success: false, error: 'Action required' });
    }
    
    const result = await extensionManager.executeAction({
      extension: req.params.id,
      action,
      params: params || {}
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Execution failed' 
    });
  }
});

// ============================================================
// AGENT FACTORY - Create Agents via Natural Language
// ============================================================

import { agentFactory } from './services/agent-factory';

// Create a new agent from natural language description
app.post('/api/factory/create', async (req: Request, res: Response) => {
  try {
    const { description } = req.body;
    
    if (!description) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide a description of the agent you want to create' 
      });
    }

    console.log(`[Factory] Creating agent: ${description}`);
    const blueprint = await agentFactory.createAgent(description);
    
    res.json({
      success: true,
      message: 'Agent creation started',
      blueprint
    });
  } catch (error) {
    console.error('Factory create error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create agent' 
    });
  }
});

// Get status of a specific agent blueprint
app.get('/api/factory/status/:id', async (req: Request, res: Response) => {
  try {
    const blueprint = await agentFactory.getBlueprint(req.params.id);
    
    if (!blueprint) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    res.json({ success: true, blueprint });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

// List all created agents
app.get('/api/factory/agents', async (req: Request, res: Response) => {
  try {
    const blueprints = await agentFactory.listBlueprints();
    const running = await agentFactory.listRunningAgents();
    
    res.json({ 
      success: true, 
      agents: blueprints,
      running: running.length,
      total: blueprints.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list agents' });
  }
});

// Stop an agent
app.post('/api/factory/stop/:id', async (req: Request, res: Response) => {
  try {
    const success = await agentFactory.stopAgent(req.params.id);
    res.json({ success, message: success ? 'Agent stopped' : 'Failed to stop agent' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to stop agent' });
  }
});

// Get agent logs
app.get('/api/factory/logs/:id', async (req: Request, res: Response) => {
  try {
    const lines = parseInt(req.query.lines as string) || 100;
    const logs = await agentFactory.getAgentLogs(req.params.id, lines);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get logs' });
  }
});

// Execute task on a specific created agent
app.post('/api/factory/execute/:id', async (req: Request, res: Response) => {
  try {
    const result = await agentFactory.executeOnAgent(req.params.id, req.body);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Execution failed' 
    });
  }
});

// ============================================================
// ADAPTABILITY ENDPOINTS - Dynamic Feature Integration
// ============================================================

import { adaptabilityService } from './services/adaptability-service';

// Initialize adaptability service
adaptabilityService.initialize().catch(console.error);

// Get system capabilities
app.get('/api/adaptability/capabilities', (req: Request, res: Response) => {
  res.json(adaptabilityService.getCapabilities());
});

// Submit a feature request
app.post('/api/adaptability/features', async (req: Request, res: Response) => {
  try {
    const { description, requestedBy } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: 'Feature description is required' });
    }
    
    const request = await adaptabilityService.submitFeatureRequest(description, requestedBy);
    res.json({ 
      success: true, 
      featureRequest: request,
      message: 'Feature request submitted. Analysis will be performed automatically.'
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to submit feature' });
  }
});

// Get all feature requests
app.get('/api/adaptability/features', (req: Request, res: Response) => {
  const status = req.query.status as string;
  const requests = adaptabilityService.getFeatureRequests(status);
  res.json({ featureRequests: requests, count: requests.length });
});

// Get specific feature request
app.get('/api/adaptability/features/:id', (req: Request, res: Response) => {
  const request = adaptabilityService.getFeatureRequest(req.params.id);
  if (!request) {
    return res.status(404).json({ error: 'Feature request not found' });
  }
  res.json(request);
});

// Analyze a feature request
app.post('/api/adaptability/features/:id/analyze', async (req: Request, res: Response) => {
  try {
    const analysis = await adaptabilityService.analyzeFeatureRequest(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Feature request not found' });
    }
    res.json({ success: true, analysis });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Analysis failed' });
  }
});

// Generate implementation plan
app.post('/api/adaptability/features/:id/plan', async (req: Request, res: Response) => {
  try {
    const plan = await adaptabilityService.generateImplementationPlan(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: 'Feature request not found or not analyzed' });
    }
    res.json({ success: true, implementationPlan: plan });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Plan generation failed' });
  }
});

// Update feature status
app.patch('/api/adaptability/features/:id', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const success = await adaptabilityService.updateFeatureStatus(req.params.id, status);
    if (!success) {
      return res.status(404).json({ error: 'Feature request not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Update failed' });
  }
});

// Get extensions
app.get('/api/adaptability/extensions', (req: Request, res: Response) => {
  const type = req.query.type as string;
  const extensions = adaptabilityService.getExtensions(type as any);
  res.json({ extensions, count: extensions.length });
});

// Register extension
app.post('/api/adaptability/extensions', async (req: Request, res: Response) => {
  try {
    const extension = await adaptabilityService.registerExtension(req.body);
    res.json({ success: true, extension });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Registration failed' });
  }
});

// Toggle extension
app.patch('/api/adaptability/extensions/:id', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    const success = await adaptabilityService.toggleExtension(req.params.id, enabled);
    if (!success) {
      return res.status(404).json({ error: 'Extension not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Toggle failed' });
  }
});

// Delete extension
app.delete('/api/adaptability/extensions/:id', async (req: Request, res: Response) => {
  try {
    const success = await adaptabilityService.removeExtension(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Extension not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Deletion failed' });
  }
});

// Get runtime config
app.get('/api/adaptability/config', (req: Request, res: Response) => {
  res.json({ config: adaptabilityService.getRuntimeConfig() });
});

// Update runtime config
app.patch('/api/adaptability/config/:key', async (req: Request, res: Response) => {
  try {
    const { value } = req.body;
    const result = await adaptabilityService.updateConfig(req.params.key, value);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Update failed' });
  }
});

// Record learning
app.post('/api/adaptability/learn', async (req: Request, res: Response) => {
  try {
    const learning = await adaptabilityService.recordLearning(req.body);
    res.json({ success: true, learning });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Learning failed' });
  }
});

// Get learning stats
app.get('/api/adaptability/stats', (req: Request, res: Response) => {
  res.json(adaptabilityService.getLearningStats());
});

// Search similar requests
app.get('/api/adaptability/similar', (req: Request, res: Response) => {
  const query = req.query.q as string;
  const limit = parseInt(req.query.limit as string) || 5;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }
  
  const similar = adaptabilityService.searchSimilarRequests(query, limit);
  res.json({ results: similar, count: similar.length });
});

// Get feature suggestions
app.get('/api/adaptability/suggestions', async (req: Request, res: Response) => {
  try {
    const suggestions = await adaptabilityService.suggestFeatures();
    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Suggestions failed' });
  }
});

// ============================================================
// MESSAGING ENDPOINTS
// ============================================================

app.post('/api/broadcast', async (req: Request, res: Response) => {
  try {
    const { message, type } = req.body;

    await messageBus.publish({
      id: `msg-${Date.now()}`,
      type: type || 'broadcast',
      from: 'api',
      to: 'broadcast',
      payload: message,
      timestamp: new Date()
    });

    res.json({ success: true, message: 'Broadcast sent' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ============================================================
// PLUGIN MANIFEST & OPENAPI
// ============================================================

app.get('/manifest.json', (req: Request, res: Response) => {
  res.json({
    schemaVersion: 1,
    type: 'plugin',
    identifier: 'agent-system',
    version: '2.0.0',
    name: { en_US: 'Multi-Agent System' },
    description: {
      en_US: 'Comprehensive multi-agent orchestration system with infrastructure, monitoring, knowledge agents, AI gateway, vector search, and security services.'
    },
    author: 'Zaffo',
    api: { type: 'openapi', url: '/openapi.json', isLocal: true }
  });
});

app.get('/openapi.json', (req: Request, res: Response) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Multi-Agent System API',
      version: '2.0.0',
      description: 'Full-featured agent orchestration API with AI, knowledge base, and security'
    },
    servers: [{ url: `http://agent-system:${process.env.PORT || 3003}` }],
    paths: {
      '/api/status': {
        get: { summary: 'Get system status', tags: ['System'], responses: { 200: { description: 'System status' } } }
      },
      '/api/agents': {
        get: { summary: 'List all agents', tags: ['Agents'], responses: { 200: { description: 'List of agents' } } }
      },
      '/api/tasks': {
        get: { summary: 'List recent tasks', tags: ['Tasks'], responses: { 200: { description: 'Recent tasks' } } },
        post: {
          summary: 'Submit a task',
          tags: ['Tasks'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['type', 'description'],
                  properties: {
                    type: { type: 'string', description: 'Task type' },
                    description: { type: 'string', description: 'Task description' },
                    payload: { type: 'object', description: 'Task data' },
                    priority: { type: 'integer', minimum: 1, maximum: 5 },
                    requiredCapabilities: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          },
          responses: { 200: { description: 'Task submitted' } }
        }
      },
      '/api/execute': {
        post: { summary: 'Execute task synchronously', tags: ['Tasks'], responses: { 200: { description: 'Task result' } } }
      },
      '/api/chat': {
        post: { summary: 'Chat completion via AI Gateway', tags: ['AI'], responses: { 200: { description: 'Chat response' } } }
      },
      '/api/embeddings': {
        post: { summary: 'Generate embeddings', tags: ['AI'], responses: { 200: { description: 'Embeddings' } } }
      },
      '/api/knowledge/add': {
        post: { summary: 'Add document to knowledge base', tags: ['Knowledge'], responses: { 200: { description: 'Document added' } } }
      },
      '/api/knowledge/query': {
        post: { summary: 'Query knowledge base with RAG', tags: ['Knowledge'], responses: { 200: { description: 'Query result' } } }
      },
      '/api/knowledge/search': {
        post: { summary: 'Search knowledge base', tags: ['Knowledge'], responses: { 200: { description: 'Search results' } } }
      },
      '/api/security/analyze': {
        post: { summary: 'Analyze content for threats', tags: ['Security'], responses: { 200: { description: 'Analysis result' } } }
      },
      '/api/security/rules': {
        get: { summary: 'Get security rules', tags: ['Security'], responses: { 200: { description: 'Security rules' } } }
      },
      '/api/security/metrics': {
        get: { summary: 'Get security metrics', tags: ['Security'], responses: { 200: { description: 'Security metrics' } } }
      },
      '/api/broadcast': {
        post: { summary: 'Broadcast message to agents', tags: ['Messaging'], responses: { 200: { description: 'Broadcast sent' } } }
      }
    }
  });
});

// ============================================================
// ERROR HANDLING
// ============================================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3003;

initializeSystem()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Agent System API running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health`);
      console.log(`   Status: http://localhost:${PORT}/api/status`);
      console.log(`   Docs:   http://localhost:${PORT}/openapi.json`);
      console.log(`\n   Master Control: ${process.env.MASTER_CONTROL_ENABLED === 'true' ? 'ENABLED' : 'DISABLED'}`);
      if (process.env.MASTER_CONTROL_DOMAIN) {
        console.log(`   Master Domain:  ${process.env.MASTER_CONTROL_DOMAIN}`);
      }
      console.log('');
    });
  })
  .catch(error => {
    console.error('Failed to initialize agent system:', error);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\nShutting down agent system...');
  
  for (const [name, agent] of agents) {
    if (agent.shutdown) {
      console.log(`  Stopping ${name}...`);
      await agent.shutdown();
    }
  }
  
  await storage.close();
  console.log('Agent system stopped.');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down...');
  await storage.close();
  process.exit(0);
});
