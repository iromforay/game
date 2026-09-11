import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { ServerOptions } from 'socket.io';

// Only used when USE_REDIS_ADAPTER=true (see main.ts / .env.example). Lets
// multiple server instances share room broadcasts via Redis pub/sub instead
// of each instance only knowing about its own directly-connected sockets -
// the scale-out path the original design doc left undecided.
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  async connectToRedis(): Promise<void> {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = process.env.REDIS_PORT ?? '6379';
    const password = process.env.REDIS_PASSWORD || undefined;
    const url = `redis://${password ? `:${password}@` : ''}${host}:${port}`;

    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();
    pubClient.on('error', (err) => console.error('[redis:pub]', err));
    subClient.on('error', (err) => console.error('[redis:sub]', err));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
