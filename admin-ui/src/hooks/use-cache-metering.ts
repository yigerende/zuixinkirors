import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  clearCacheMetering,
  clearCacheMeteringExpired,
  getCacheMetering,
  setCacheMetering,
} from '@/api/credentials'
import type { CacheMeteringConfig } from '@/types/api'

export function useCacheMetering() {
  return useQuery({
    queryKey: ['cache-metering'],
    queryFn: getCacheMetering,
  })
}

export function useSetCacheMetering() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (config: CacheMeteringConfig) => setCacheMetering(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache-metering'] })
    },
  })
}

export function useClearCacheMetering() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: clearCacheMetering,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache-metering'] })
    },
  })
}

export function useClearCacheMeteringExpired() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: clearCacheMeteringExpired,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache-metering'] })
    },
  })
}
