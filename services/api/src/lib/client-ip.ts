/**
 * Which header carries the real client address depends on what sits in front
 * of the API, and trusting the wrong one hands every caller a way to pick
 * their own rate-limit bucket. So the header is configuration, not a guess:
 *
 *   CLIENT_IP_HEADER=X-Forwarded-For   (default; Caddy, nginx, most proxies)
 *   CLIENT_IP_HEADER=CF-Connecting-IP  (Cloudflare in front)
 *
 * For X-Forwarded-For the LAST hop is used — it is the one appended by our own
 * proxy; anything before it was supplied by the client.
 *
 * When that last hop is one of Cloudflare's own addresses, the request came
 * through Cloudflare (api.studioautopilot.in is proxied there, because some
 * home internet providers cannot reach the server's address) and the person
 * is in CF-Connecting-IP. Only then is that header trusted -- anyone else
 * sending it is ignored.
 */
interface HeaderReader {
  get(name: string): string | undefined | null
}

export function resolveClientIp(headers: HeaderReader, configured: string | undefined): string {
  const name = (configured ?? '').trim() || 'X-Forwarded-For'
  const raw = headers.get(name) ?? ''
  if (!raw) return 'unknown'
  if (name.toLowerCase() === 'x-forwarded-for') {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const peer = parts[parts.length - 1] ?? 'unknown'
    const viaCloudflare = headers.get('CF-Connecting-IP')?.trim()
    return viaCloudflare && isCloudflare(peer) ? viaCloudflare : peer
  }
  return raw.trim() || 'unknown'
}

/** Cloudflare's published ranges (cloudflare.com/ips). */
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
]

export function isCloudflare(ip: string): boolean {
  const addr = parseIp(ip.replace(/^::ffff:(?=\d+\.)/i, ''))
  if (!addr) return false
  return CLOUDFLARE_RANGES.some((cidr) => {
    const [base, bits] = cidr.split('/') as [string, string]
    const net = parseIp(base)
    if (!net || net.v6 !== addr.v6) return false
    const width = addr.v6 ? 128n : 32n
    const shift = width - BigInt(bits)
    return addr.value >> shift === net.value >> shift
  })
}

function parseIp(ip: string): { v6: boolean; value: bigint } | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.').map(Number)
    if (parts.some((n) => n > 255)) return null
    return { v6: false, value: parts.reduce((acc, n) => (acc << 8n) | BigInt(n), 0n) }
  }
  if (!ip.includes(':') || !/^[0-9a-f:]+$/i.test(ip)) return null
  const [head = '', tail, extra] = ip.split('::')
  if (extra !== undefined) return null
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const fill = tail === undefined ? 0 : 8 - left.length - right.length
  if (fill < 0 || (tail === undefined && left.length !== 8)) return null
  const groups = [...left, ...Array<string>(fill).fill('0'), ...right]
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return { v6: true, value: groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n) }
}
