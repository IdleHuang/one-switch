import { app } from 'electron'
import { getSettings, onSettingsChanged } from '@server/database/settings-store'
import type { Settings } from '@common/schemas'

/**
 * 开机自启管理器
 * 同步设置中的 autoLaunch 到系统登录项
 */
export class AutoLaunchManager {
  private currentValue = false

  async init(): Promise<void> {
    // 读取当前设置并应用
    try {
      const settings = await getSettings()
      this.apply(settings.autoLaunch)
    } catch (err) {
      console.error('[auto-launch] failed to read settings', err)
    }

    // 监听设置变更
    onSettingsChanged((settings: Settings) => {
      if (settings.autoLaunch !== this.currentValue) {
        this.apply(settings.autoLaunch)
      }
    })
  }

  private apply(enabled: boolean): void {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        // macOS 用它表达「登录后静默启动」，主进程读 `app.wasOpenedAsHidden`。
        openAsHidden: true,
        // Windows 不认 `openAsHidden`，只能靠启动参数；主进程读 `--hidden`
        //（见 `index.ts` 里的 `startHidden`）。Linux 的登录项由打包产物生成，同样按参数传。
        args: ['--hidden'],
      })
      this.currentValue = enabled
      console.info(`[auto-launch] state updated enabled=${enabled}`)
    } catch (err) {
      console.error(`[auto-launch] failed to set login item enabled=${enabled}`, err)
    }
  }
}
