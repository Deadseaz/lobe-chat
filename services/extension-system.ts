import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

export interface Extension {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  entryPoint: string;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtensionConfig {
  extensionsPath: string;
}

export class ExtensionSystem {
  private extensions: Map<string, Extension> = new Map();
  private loadedExtensions: Map<string, any> = new Map();
  private config: ExtensionConfig;

  constructor(config: ExtensionConfig) {
    this.config = config;
    this.ensureExtensionsDir();
    this.loadExtensions();
  }

  private ensureExtensionsDir() {
    if (!fs.existsSync(this.config.extensionsPath)) {
      fs.mkdirSync(this.config.extensionsPath, { recursive: true });
    }
  }

  private loadExtensions() {
    if (!fs.existsSync(this.config.extensionsPath)) {
      return;
    }

    const files = fs.readdirSync(this.config.extensionsPath);
    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.ts')) {
        this.loadExtensionFromFile(path.join(this.config.extensionsPath, file));
      }
    }
  }

  private loadExtensionFromFile(filePath: string) {
    try {
      const code = fs.readFileSync(filePath, 'utf8');
      console.log(`Loaded extension code from ${filePath}`);
      const fileName = path.basename(filePath, path.extname(filePath));

      const extension: Extension = {
        id: fileName,
        name: fileName,
        version: '1.0.0',
        description: `Extension ${fileName}`,
        author: 'System',
        enabled: true,
        entryPoint: filePath,
        permissions: ['read', 'write'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.extensions.set(extension.id, extension);
    } catch (error) {
      console.error(`Failed to load extension from ${filePath}:`, error);
    }
  }

  async registerExtension(extension: Omit<Extension, 'id' | 'createdAt' | 'updatedAt'>): Promise<Extension> {
    const id = this.generateId();
    const newExtension: Extension = {
      ...extension,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.extensions.set(id, newExtension);

    if (newExtension.entryPoint) {
      const extensionPath = path.join(this.config.extensionsPath, `${id}.js`);
      fs.writeFileSync(extensionPath, newExtension.entryPoint);
    }

    return newExtension;
  }

  async enableExtension(id: string): Promise<boolean> {
    const extension = this.extensions.get(id);
    if (!extension) return false;
    extension.enabled = true;
    extension.updatedAt = new Date();
    return true;
  }

  async disableExtension(id: string): Promise<boolean> {
    const extension = this.extensions.get(id);
    if (!extension) return false;
    extension.enabled = false;
    extension.updatedAt = new Date();
    if (this.loadedExtensions.has(id)) {
      this.loadedExtensions.delete(id);
    }
    return true;
  }

  getExtensions(): Extension[] {
    return Array.from(this.extensions.values());
  }

  getExtension(id: string): Extension | undefined {
    return this.extensions.get(id);
  }

  async executeExtensionFunction(extensionId: string, functionName: string, ...args: any[]): Promise<any> {
    if (!this.loadedExtensions.has(extensionId)) {
      await this.loadExtension(extensionId);
    }

    const extension = this.loadedExtensions.get(extensionId);
    if (!extension || typeof extension[functionName] !== 'function') {
      throw new Error(`Function ${functionName} not found in extension ${extensionId}`);
    }

    return extension[functionName](...args);
  }

  private async loadExtension(id: string): Promise<boolean> {
    const extension = this.extensions.get(id);
    if (!extension || !extension.enabled) {
      return false;
    }

    try {
      const extensionPath = path.join(this.config.extensionsPath, `${id}.js`);
      if (!fs.existsSync(extensionPath)) {
        return false;
      }

      const code = fs.readFileSync(extensionPath, 'utf8');

      const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Buffer,
        require: (moduleName: string) => {
          if (['fs', 'path', 'url', 'util'].includes(moduleName)) {
            return require(moduleName);
          }
          throw new Error(`Module ${moduleName} not allowed`);
        },
        module: { exports: {} },
        exports: {},
      };

      const script = new vm.Script(code);
      const context = vm.createContext(sandbox);
      script.runInContext(context);

      this.loadedExtensions.set(id, context['module'].exports);

      return true;
    } catch (error) {
      console.error(`Failed to load extension ${id}:`, error);
      return false;
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}
