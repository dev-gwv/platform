// The local server has no Facebook app keys, so it hides Connect with Facebook.
// On the live app the button is there; show it as the studio sees it. Nothing
// else is faked, and the button is never followed to facebook.com.
import { API } from './lib.mjs'
export async function showConnectButton(page) {
  await page.route(API + '/meta/connect-url', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ connect_url: 'https://www.facebook.com/dialog/oauth', app_id: '1', redirect_uri: 'https://app.studioautopilot.in/lead-sources', missing_config: [] }),
  }))
}
