/**
 * `--help` 的输出。
 *
 * 左列（旗标、取值占位、命令名）是**代码**，来自本文件而不是目录；取值的默认值来自
 * `host.ts` 的预设与平台默认数据目录，与真正启动时算出来的那份一致，
 * 避免帮助里写一套、实际跑另一套。
 *
 * 列宽只按左列算（都是 ASCII 定宽），所以中英文目录各占一行也不会错位。
 */

import type { TranslateParams } from '@common/i18n'
import { getRuntimeProfile } from '@common/runtime-profile'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { cliTranslator } from '../native-i18n'
import { CLI_RUNTIME_ENVIRONMENT, defaultDataDirectory } from '../host'
import { CLI_COMMANDS, type CliCommand } from '../options'

const OPTION_COLUMN_WIDTH = 26
const COMMAND_COLUMN_WIDTH = 9

const COMMAND_KEYS: Record<CliCommand, UiCatalogKey> = {
  start: 'native.cli.command.start',
  stop: 'native.cli.command.stop',
  status: 'native.cli.command.status',
  version: 'native.cli.command.version',
}

interface OptionRow {
  flag: string
  key: UiCatalogKey
  params?: TranslateParams
}

export function renderHelp(): string {
  const t = cliTranslator()
  const profile = getRuntimeProfile(CLI_RUNTIME_ENVIRONMENT)
  const defaultHost = '127.0.0.1'

  const optionRows: OptionRow[] = [
    { flag: '-h, --help', key: 'native.cli.option.help' },
    { flag: '-v, --version', key: 'native.cli.option.version' },
    { flag: '--data-dir <path>', key: 'native.cli.option.dataDir', params: { default: defaultDataDirectory() } },
    { flag: '--host <host>', key: 'native.cli.option.host', params: { default: defaultHost } },
    { flag: '--proxy-port <port>', key: 'native.cli.option.proxyPort', params: { default: profile.proxyPort } },
    {
      flag: '--management-port <port>',
      key: 'native.cli.option.managementPort',
      params: { default: profile.managementPort },
    },
    { flag: '--web', key: 'native.cli.option.web' },
    { flag: '--no-web', key: 'native.cli.option.noWeb' },
    { flag: '--json', key: 'native.cli.option.json' },
  ]

  const lines: string[] = [
    t('native.cli.usage'),
    '',
    t('native.cli.commands'),
    ...CLI_COMMANDS.map(command =>
      `  ${command.padEnd(COMMAND_COLUMN_WIDTH)}${t(COMMAND_KEYS[command])}`,
    ),
    '',
    t('native.cli.options'),
    ...optionRows.map(row => `  ${row.flag.padEnd(OPTION_COLUMN_WIDTH)}${t(row.key, row.params)}`),
    '',
    // 没有 `--management-host`：管理服务不带鉴权，只监听回环。写在这里，
    // 免得有人翻遍选项去找那个不存在的旗标。
    `  ${t('native.cli.managementLoopback')}`,
  ]

  return lines.join('\n')
}
