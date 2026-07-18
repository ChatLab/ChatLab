import { computed, ref } from 'vue'
import { syncNativeDialog, type NativeDialogController } from './native-dialog'

export function useLockScreenBootstrap(isElectron: boolean) {
  const isLockScreenReady = ref(!isElectron)
  const isLocked = ref(isElectron)
  const isBootstrapMaskVisible = computed(() => isElectron && !isLockScreenReady.value)
  // 这里只阻断全局快捷键等应用交互，不控制业务组件挂载，避免锁定时丢失未保存状态。
  const isApplicationInteractive = computed(() => !isElectron || (isLockScreenReady.value && !isLocked.value))

  function markLockScreenReady(): void {
    isLockScreenReady.value = true
  }

  function updateLockState(locked: boolean): void {
    if (!isElectron) return
    isLocked.value = locked
  }

  function syncBootstrapMask(dialog: NativeDialogController | null): void {
    syncNativeDialog(dialog, isBootstrapMaskVisible.value)
  }

  return {
    isBootstrapMaskVisible,
    isApplicationInteractive,
    markLockScreenReady,
    syncBootstrapMask,
    updateLockState,
  }
}
