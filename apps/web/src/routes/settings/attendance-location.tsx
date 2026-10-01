import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { AttendanceSettingsPanel } from '@/features/attendance/AttendanceSettings'

/**
 * Settings → Attendance (the path keeps its old name: links and bookmarks
 * point here). Off until the owner turns it on; then where, when, and how.
 */
export function AttendanceLocationPage() {
  return (
    <AuthedPage module="settings">
      <PageHeader title="Attendance" />
      <AttendanceSettingsPanel />
    </AuthedPage>
  )
}
