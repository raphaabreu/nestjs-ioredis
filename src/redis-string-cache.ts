import { StructuredLogger } from '@raphaabreu/nestjs-opensearch-structured-logger';
import { stringify, parse } from 'flatted';
import { RedisCluster } from './redis.cluster';

export type RedisStringCacheOptions<T = any> = {
  serializer?: (event: T) => string;
  deserializer?: (event: string) => T;

  keyPrefix?: string;

  getErrorBehavior?: 'throws' | 'returnsNull';
  deserializeErrorBehavior?: 'removes' | 'ignores';
  setErrorBehavior?: 'throws' | 'ignores';
};

const defaultOptions: Partial<RedisStringCacheOptions> = {
  serializer: stringify,
  deserializer: parse,

  keyPrefix: '',

  getErrorBehavior: 'returnsNull',
  deserializeErrorBehavior: 'removes',
  setErrorBehavior: 'ignores',
};

export class RedisStringCache<T = any> {
  private readonly logger = new StructuredLogger(RedisStringCache.name);

  private readonly options: RedisStringCacheOptions<T>;

  constructor(private readonly redis: RedisCluster, options?: RedisStringCacheOptions<T>) {
    this.options = { ...defaultOptions, ...options };
  }

  static register<T>(options: RedisStringCacheOptions<T>) {
    return {
      provide: RedisStringCache,
      inject: [RedisCluster],
      useFactory: (redisCluster: RedisCluster) => new RedisStringCache(redisCluster, options),
    };
  }

  async get(key: string): Promise<T | null> {
    key = this.getKey(key);
    let data: string;

    try {
      data = await this.redis.get(key);
      if (!data) {
        return null;
      }
    } catch (error) {
      this.logger.error('Failed to get key ${key} from cache', error, key);

      if (this.options.getErrorBehavior === 'returnsNull') {
        return null;
      }

      throw error;
    }

    try {
      const result = this.options.deserializer(data);

      return result;
    } catch (error) {
      this.logger.error('Failed to deserialize key ${key} from cache with value ${value}', error, key, data);

      if (this.options.deserializeErrorBehavior === 'removes') {
        await this.remove(key);
      }
      if (this.options.getErrorBehavior === 'returnsNull') {
        return null;
      }

      throw error;
    }
  }

  async set(key: string, value: T | null, ttl: number): Promise<void> {
    key = this.getKey(key);

    let serializedValue: string;

    try {
      serializedValue = this.options.serializer(value);
    } catch (error) {
      this.logger.error('Failed to serialize value for key ${key}', error, key);

      if (this.options.setErrorBehavior === 'ignores') {
        return;
      }
      throw error;
    }

    try {
      if (ttl > 0) {
        await this.redis.setex(key, ttl, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
    } catch (error) {
      this.logger.error('Failed to set value for key ${key}', error, key);

      if (this.options.setErrorBehavior === 'ignores') {
        return;
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    key = this.getKey(key);

    await this.redis.del(key);
  }

  private getKey(key: string) {
    return `${this.options.keyPrefix}${this.options.keyPrefix ? ':' : ''}${key}`;
  }
}
