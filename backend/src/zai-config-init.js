// Auto-write .z-ai-config from env vars (for cloud deployment)
// This allows the SDK to read the config from environment variables
// instead of relying on a file present at deploy time.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function writeZaiConfig() {
  if (process.env.ZAI_BASE_URL && process.env.ZAI_API_KEY) {
    const config = {
      baseUrl: process.env.ZAI_BASE_URL,
      apiKey: process.env.ZAI_API_KEY,
      userId: process.env.ZAI_USER_ID || '',
      chatId: process.env.ZAI_CHAT_ID || '',
      token: process.env.ZAI_TOKEN || ''
    };
    const configStr = JSON.stringify(config, null, 2);
    
    // Write to multiple locations searched by the SDK
    const paths = [
      path.join(process.cwd(), '.z-ai-config'),
      path.join(os.homedir(), '.z-ai-config'),
      '/etc/.z-ai-config'
    ];
    for (const p of paths) {
      try {
        // Ensure parent dir exists
        await mkdir(path.dirname(p), { recursive: true });
        await writeFile(p, configStr, 'utf8');
        console.log(`[zai-config] Wrote to ${p}`);
      } catch (e) {
        // Ignore permission errors (e.g. /etc/ on read-only FS)
        if (e.code !== 'EACCES' && e.code !== 'EROFS') {
          console.warn(`[zai-config] Failed to write ${p}: ${e.message}`);
        }
      }
    }
    console.log('[zai-config] Configuration written from env vars');
  } else {
    console.log('[zai-config] Env vars not set, using existing .z-ai-config file');
  }
}
