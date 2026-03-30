import { useQuery } from '@tanstack/react-query';

export interface RedisSnapshot {
  ts: number;
  usedMemory: number;
  usedMemoryPeak: number;
  maxmemory: number;
  memFragmentationRatio: number | null;
  connectedClients: number;
  opsPerSec: number;
  totalKeys: number;
  usedMemoryRss: number | null;
  maxmemoryPolicy: string | null;
}

export interface OOMProjection {
  hoursUntilOOM: number | null;
  growthRateMBPerHour: number;
}

export interface KeyGrowth {
  queue: string;
  keyType: string;
  entries: number;
  entryDelta: number;
  memoryBytes: number | null;
  memoryDelta: number | null;
}

export interface RedisKeySize {
  ts: number;
  queue: string;
  keyType: string;
  entryCount: number;
  memoryBytes: number | null;
}

export interface SlowlogEntry {
  ts: number;
  durationUs: number;
  command: string;
  isBullMQ: boolean;
}

export interface RedisHealthResponse {
  snapshot: RedisSnapshot | null;
  oomProjection: OOMProjection;
  maxmemoryPolicyWarning: string | null;
  topGrowthContributors: KeyGrowth[];
}

export function useRedisHealth() {
  return useQuery<RedisHealthResponse>({
    queryKey: ['redis-health'],
    queryFn: () => fetch('/api/redis/health').then((r) => r.json()),
    refetchInterval: 10000,
  });
}

export function useRedisHistory(range: '1h' | '6h' | '24h' | '7d' = '1h') {
  return useQuery<{ snapshots: RedisSnapshot[]; since: number; until: number }>({
    queryKey: ['redis-history', range],
    queryFn: () => fetch(`/api/redis/history?range=${range}`).then((r) => r.json()),
    refetchInterval: 30000,
  });
}

export function useRedisKeySizes() {
  return useQuery<{ keySizes: RedisKeySize[]; growth: KeyGrowth[]; collectedAt: number | null }>({
    queryKey: ['redis-key-sizes'],
    queryFn: () => fetch('/api/redis/key-sizes').then((r) => r.json()),
    refetchInterval: 60000,
  });
}

export function useRedisSlowlog() {
  return useQuery<{ entries: SlowlogEntry[] }>({
    queryKey: ['redis-slowlog'],
    queryFn: () => fetch('/api/redis/slowlog').then((r) => r.json()),
    refetchInterval: 30000,
  });
}
