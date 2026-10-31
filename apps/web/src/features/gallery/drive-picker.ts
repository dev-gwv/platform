import type { DrivePicker } from '@ipc/contracts'

/**
 * Google's own file picker (Google Picker API) on our page, with a drive.file
 * token Frameline gives for the studio's connected Drive (GET
 * /projects/:id/gallery/drive/picker). Picking a file or folder is what lets
 * Frameline read it, so the copy itself runs on Frameline's servers. Resolves
 * with the picked ids, empty when the studio closes it.
 *
 * The same picker as Frameline's admin (its drivePicker.ts). Google draws it
 * from apis.google.com in a docs.google.com frame (both allowed in
 * public/_headers), and the Picker's key must list this site as a referrer.
 */

interface PickerDoc {
  id: string
}
interface PickerData {
  action: string
  docs?: PickerDoc[]
}
interface PickerBuilder {
  addView(v: unknown): PickerBuilder
  enableFeature(f: unknown): PickerBuilder
  setOAuthToken(t: string): PickerBuilder
  setDeveloperKey(k: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setTitle(t: string): PickerBuilder
  setCallback(cb: (d: PickerData) => void): PickerBuilder
  build(): { setVisible(v: boolean): void }
}
interface GooglePicker {
  PickerBuilder: new () => PickerBuilder
  DocsView: new (viewId?: unknown) => { setIncludeFolders(v: boolean): unknown; setSelectFolderEnabled(v: boolean): unknown; setMimeTypes(m: string): unknown }
  ViewId: { DOCS: unknown }
  Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES: unknown }
  Action: { PICKED: string; CANCEL: string }
}
type GapiWindow = Window & { gapi?: { load(name: string, cb: () => void): void }; google?: { picker?: GooglePicker } }

const SCRIPT = 'https://apis.google.com/js/api.js'
/** Folders and the photo types Frameline imports. */
const MIME = 'application/vnd.google-apps.folder,image/jpeg,image/png,image/webp,image/heic,image/heif'

let loading: Promise<GooglePicker> | null = null
function loadPicker(): Promise<GooglePicker> {
  const w = window as GapiWindow
  if (w.google?.picker) return Promise.resolve(w.google.picker)
  loading ??= new Promise<GooglePicker>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT
    s.async = true
    s.onerror = () => {
      loading = null
      reject(new Error('Google Drive didn’t open. Check your internet, or turn off a blocker for apis.google.com.'))
    }
    s.onload = () => w.gapi!.load('picker', () => (w.google?.picker ? resolve(w.google.picker) : reject(new Error('Google Drive didn’t open. Please try again.'))))
    document.head.appendChild(s)
  })
  return loading
}

export async function pickFromDrive(cfg: DrivePicker): Promise<string[]> {
  const picker = await loadPicker()
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
    view.setIncludeFolders(true)
    view.setSelectFolderEnabled(true)
    view.setMimeTypes(MIME)
    let builder = new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setTitle('Pick folders or photos for the gallery')
      .setOAuthToken(cfg.access_token)
      .setDeveloperKey(cfg.api_key)
      .setCallback((d) => {
        if (d.action === picker.Action.PICKED) resolve((d.docs ?? []).map((doc) => doc.id))
        else if (d.action === picker.Action.CANCEL) resolve([])
      })
    if (cfg.app_id) builder = builder.setAppId(cfg.app_id)
    builder.build().setVisible(true)
  })
}
