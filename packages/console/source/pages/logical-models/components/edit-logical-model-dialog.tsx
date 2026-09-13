import { useEffect, useState } from 'react'
import type { LogicalModel } from '@common/schemas'
import { logicalModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

interface EditLogicalModelDialogProps {
  /** 被编辑的逻辑模型；为 null 时说明数据还没就绪，对话框保持空壳。 */
  logicalModel: LogicalModel | null
  /** 内建默认逻辑模型：名称是请求兜底匹配的依据，只允许改说明。 */
  builtIn?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 保存成功后回调，调用方负责刷新列表。 */
  onSaved: () => void
}

export function EditLogicalModelDialog(props: EditLogicalModelDialogProps) {
  const { logicalModel, builtIn, open, onOpenChange, onSaved } = props
  const toast = useToast()
  const t = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [nameError, setNameError] = useState('')
  const [saving, setSaving] = useState(false)

  // 对话框是常驻组件，每次打开都按当前记录重新填表，否则第二次打开会残留上一次的草稿。
  useEffect(() => {
    if (!open || !logicalModel) return
    setName(logicalModel.name)
    setDescription(logicalModel.description)
    setNameError('')
  }, [open, logicalModel])

  const save = async () => {
    if (!logicalModel) return
    const trimmedName = name.trim()
    // 名称留空会让卡片头变成一片空白，其他字段都没有这种「看着像没坏但什么都没了」的失败态，
    // 所以就地拦下来，而不是等服务端 schema 报错。
    if (!builtIn && !trimmedName) {
      setNameError(t('logicalModels.edit.nameRequired'))
      return
    }
    setSaving(true)
    try {
      await unwrap(logicalModelApi.update(logicalModel.id, builtIn
        ? { description: description.trim() }
        : { name: trimmedName, description: description.trim() }))
      toast.success(t('logicalModels.edit.saved'))
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('logicalModels.edit.title')}</DialogTitle>
          <DialogDescription>{t('logicalModels.edit.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField
            label={t('logicalModels.edit.nameLabel')}
            htmlFor="logical-model-name"
            error={nameError}
            required={!builtIn}
            hint={builtIn ? t('logicalModels.edit.builtInNameHint') : t('logicalModels.edit.nameHint')}
          >
            <Input
              id="logical-model-name"
              value={name}
              disabled={builtIn}
              maxLength={100}
              aria-invalid={Boolean(nameError)}
              onChange={event => { setName(event.target.value); if (nameError) setNameError('') }}
              autoFocus={!builtIn}
            />
          </FormField>
          <FormField label={t('logicalModels.edit.descriptionLabel')} htmlFor="logical-model-edit-description">
            <Input
              id="logical-model-edit-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder={t('logicalModels.edit.descriptionPlaceholder')}
              autoFocus={builtIn}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.action.cancel')}</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? t('logicalModels.edit.submitting') : t('logicalModels.edit.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
