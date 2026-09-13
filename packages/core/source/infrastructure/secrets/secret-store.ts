import type { SecretStore } from '@common/secret-store'

let secretStore: SecretStore | null = null

export function configureSecretStore(store: SecretStore): void {
  secretStore = store
}

export function getSecretStore(): SecretStore {
  if (!secretStore) throw new Error('Secret store is not configured')
  return secretStore
}
