import { requireAction } from '../../middleware/permissions'

export const edit = requireAction('crm', 'edit')
export const remove = requireAction('crm', 'delete')
