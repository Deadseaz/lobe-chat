import { Client } from 'ssh2';
import { Context } from 'hono';

export class SSHService {
  private conn: Client;

  constructor() {
    this.conn = new Client();
  }

  public connect(config: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.on('ready', () => {
        resolve();
      }).on('error', (err) => {
        reject(err);
      }).connect(config);
    });
  }

  public execute(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.conn.exec(command, (err, stream) => {
        if (err) {
          return reject(err);
        }
        let data = '';
        stream.on('close', () => {
          this.conn.end();
          resolve(data);
        }).on('data', (chunk: string) => {
          data += chunk;
        }).stderr.on('data', (data: string) => {
          // For simplicity, we'll just append stderr to the output
          data += data;
        });
      });
    });
  }
}

export async function initializeSSHService(c: Context, next: () => Promise<void>) {
  const service = new SSHService();
  c.set('sshService', service);
  await next();
}
