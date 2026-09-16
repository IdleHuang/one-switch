import { describe, expect, it } from 'vitest'
import {
  DATABASE_ROLES,
  DATABASE_SCHEMA_VERSIONS,
  createDatabaseFileName,
  listCurrentDatabaseFileNames,
} from './database-file'

describe('database file name', () => {
  it('names the two databases after their role and schema version', () => {
    expect(createDatabaseFileName('config')).toBe('one-switch-config-v2.db')
    expect(createDatabaseFileName('data')).toBe('one-switch-data-v1.db')
  })

  it('gives every role its own file', () => {
    const names = DATABASE_ROLES.map(createDatabaseFileName)

    expect(new Set(names).size).toBe(DATABASE_ROLES.length)
  })

  it('lists exactly the files this version opens', () => {
    expect(listCurrentDatabaseFileNames().sort()).toEqual([
      'one-switch-config-v2.db',
      'one-switch-data-v1.db',
    ])
  })

  it('carries the schema version in the file name', () => {
    // 版本号变了文件名就变，这是「换代」的全部机制：照着常量拼一遍，两者不可能对不上。
    for (const role of DATABASE_ROLES) {
      expect(createDatabaseFileName(role)).toBe(`one-switch-${role}-v${DATABASE_SCHEMA_VERSIONS[role]}.db`)
    }
  })
})
