import { describe, expect, it } from 'vitest'
import { metaConnectUrl } from './router'

const env = { META_APP_ID: '111', APP_URL: 'https://studioautopilot.in/' }

describe('the Connect with Facebook link', () => {
  it('waits for the app id and the web address', () => {
    expect(metaConnectUrl({ APP_URL: env.APP_URL })).toBeNull()
    expect(metaConnectUrl({ ...env, APP_URL: '' })).toBeNull()
  })

  it('asks for the lead permissions by scope on a plain app', () => {
    const url = new URL(metaConnectUrl(env)!)
    expect(url.pathname).toBe('/v24.0/dialog/oauth')
    expect(url.searchParams.get('redirect_uri')).toBe('https://studioautopilot.in/lead-sources')
    expect(url.searchParams.get('scope')).toBe('pages_show_list,pages_manage_metadata,pages_read_engagement,business_management,leads_retrieval')
    expect(url.searchParams.get('config_id')).toBeNull()
    // The permission dialog shows again, even after a connection before.
    expect(url.searchParams.get('auth_type')).toBe('rerequest')
  })

  it('uses the Login for Business configuration when one is set', () => {
    const url = new URL(metaConnectUrl({ ...env, META_LOGIN_CONFIG_ID: '999' })!)
    expect(url.searchParams.get('config_id')).toBe('999')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBeNull()
    expect(url.searchParams.get('auth_type')).toBe('rerequest')
  })
})
