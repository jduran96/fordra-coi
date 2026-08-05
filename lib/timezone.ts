/**
 * What time is it at the agency we have to call?
 *
 * Admin triage aid (owner, 2026-08-04): the review queue gets worked top to
 * bottom, but an East-coast agency closes three hours before a California
 * one. Knowing the local clock at the issuing agency WITHOUT opening the case
 * lets an admin call the offices that are about to close first. The answer is
 * already sitting in the OCR extraction, so this asks nothing new of anyone —
 * it reads `coi_extracted` and derives a zone.
 *
 * Derivation order:
 *   1. The US state in the agency's address (`insurance_company_address`).
 *   2. Its area code (`insurance_company_phone`), which both DISAMBIGUATES
 *      states that straddle two zones and covers certificates whose producer
 *      box has a phone but no parseable address.
 * Anything we cannot place returns null and renders as a dash. A wrong
 * timezone is worse than no timezone here, since the entire point is deciding
 * who to call before 5pm their time.
 *
 * Precision is deliberately "good enough to sequence calls", not survey
 * grade: a handful of area codes genuinely span two zones (Florida's 850,
 * Michigan's 906, southern Indiana, the western halves of the Plains states).
 * Those resolve to their dominant zone and set `approximate`, which the
 * tooltip says out loud.
 */

import { C } from './theme'

const ZONES = {
  eastern: 'America/New_York',
  central: 'America/Chicago',
  mountain: 'America/Denver',
  arizona: 'America/Phoenix',
  pacific: 'America/Los_Angeles',
  alaska: 'America/Anchorage',
  hawaii: 'Pacific/Honolulu',
  atlantic: 'America/Puerto_Rico',
  chamorro: 'Pacific/Guam',
  samoa: 'Pacific/Pago_Pago',
} as const

type ZoneKey = keyof typeof ZONES

/** Plain-English zone name for the tooltip. */
const ZONE_NAMES: Record<ZoneKey, string> = {
  eastern: 'Eastern',
  central: 'Central',
  mountain: 'Mountain',
  arizona: 'Arizona (no daylight saving)',
  pacific: 'Pacific',
  alaska: 'Alaska',
  hawaii: 'Hawaii',
  atlantic: 'Atlantic',
  chamorro: 'Chamorro',
  samoa: 'Samoa',
}

/**
 * State/territory -> dominant zone. States in SPLIT_STATES really do span two
 * zones; the area code decides when we have one, and when we don't the answer
 * is flagged approximate rather than hidden.
 */
const STATE_ZONES: Record<string, ZoneKey> = {
  AL: 'central', AK: 'alaska', AZ: 'arizona', AR: 'central', CA: 'pacific',
  CO: 'mountain', CT: 'eastern', DE: 'eastern', DC: 'eastern', FL: 'eastern',
  GA: 'eastern', HI: 'hawaii', ID: 'mountain', IL: 'central', IN: 'eastern',
  IA: 'central', KS: 'central', KY: 'eastern', LA: 'central', ME: 'eastern',
  MD: 'eastern', MA: 'eastern', MI: 'eastern', MN: 'central', MS: 'central',
  MO: 'central', MT: 'mountain', NE: 'central', NV: 'pacific', NH: 'eastern',
  NJ: 'eastern', NM: 'mountain', NY: 'eastern', NC: 'eastern', ND: 'central',
  OH: 'eastern', OK: 'central', OR: 'pacific', PA: 'eastern', RI: 'eastern',
  SC: 'eastern', SD: 'central', TN: 'central', TX: 'central', UT: 'mountain',
  VT: 'eastern', VA: 'eastern', WA: 'pacific', WV: 'eastern', WI: 'central',
  WY: 'mountain',
  PR: 'atlantic', VI: 'atlantic', GU: 'chamorro', AS: 'samoa',
}

/** States that straddle a zone boundary: the state alone is only a guess. */
const SPLIT_STATES = new Set(['FL', 'ID', 'IN', 'KS', 'KY', 'MI', 'ND', 'NE', 'OR', 'SD', 'TN', 'TX'])

/** Spelled-out state names, for addresses that don't abbreviate. */
const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR',
}

/**
 * NANP area codes by zone — the tiebreaker inside a split state, and the whole
 * answer when the address is unparseable. Codes that themselves cover two
 * zones sit under their dominant one and repeat in SPLIT_AREA_CODES.
 */
const ZONE_AREA_CODES: Record<ZoneKey, number[]> = {
  eastern: [
    202, 203, 207, 212, 215, 216, 219, 220, 223, 227, 229, 231, 234, 239, 240,
    248, 252, 260, 267, 269, 272, 276, 301, 302, 304, 305, 313, 315, 317, 321,
    326, 330, 332, 336, 339, 347, 351, 352, 363, 380, 386, 401, 404, 407, 410,
    412, 413, 419, 423, 434, 440, 443, 445, 448, 463, 470, 475, 478, 484, 502,
    508, 513, 516, 517, 518, 540, 551, 561, 567, 570, 571, 574, 582, 585, 586,
    603, 606, 607, 609, 610, 614, 616, 617, 631, 640, 646, 656, 667, 678, 679,
    680, 681, 689, 703, 704, 706, 716, 717, 718, 724, 727, 732, 734, 740, 743,
    754, 757, 762, 765, 770, 771, 772, 774, 781, 786, 802, 803, 804, 810, 812,
    813, 814, 821, 826, 828, 835, 838, 839, 843, 845, 848, 854, 856, 857, 859,
    862, 863, 864, 865, 878, 904, 906, 908, 910, 912, 914, 917, 919, 929, 930,
    934, 937, 941, 943, 947, 948, 954, 959, 973, 978, 980, 984, 989,
  ],
  central: [
    205, 210, 214, 217, 218, 224, 225, 228, 251, 254, 256, 262, 270, 274, 281,
    308, 309, 314, 316, 318, 319, 320, 325, 331, 334, 337, 346, 361, 364, 402,
    405, 409, 414, 417, 430, 432, 447, 464, 469, 479, 501, 504, 507, 512, 515,
    531, 534, 539, 557, 563, 572, 573, 580, 601, 605, 608, 612, 615, 618, 620,
    629, 630, 636, 641, 651, 659, 660, 662, 682, 701, 708, 712, 713, 715, 726,
    730, 731, 737, 763, 769, 773, 779, 785, 806, 815, 816, 817, 830, 832, 847,
    850, 861, 870, 872, 901, 903, 913, 918, 920, 931, 936, 938, 940, 945, 952,
    956, 972, 975, 979, 985,
  ],
  mountain: [208, 303, 307, 385, 406, 435, 505, 575, 719, 720, 801, 915, 970, 983, 986],
  arizona: [480, 520, 602, 623, 928],
  pacific: [
    206, 209, 213, 253, 279, 310, 323, 341, 350, 360, 408, 415, 424, 425, 442,
    458, 503, 509, 510, 530, 541, 559, 562, 564, 619, 626, 628, 650, 657, 661,
    669, 702, 707, 714, 725, 747, 760, 775, 805, 818, 820, 831, 840, 858, 909,
    916, 925, 949, 951, 971,
  ],
  alaska: [907],
  hawaii: [808],
  atlantic: [340, 787, 939],
  chamorro: [671],
  samoa: [684],
}

/** Area codes that themselves cover two zones — resolved to the dominant one. */
const SPLIT_AREA_CODES = new Set([208, 308, 605, 620, 701, 812, 850, 906, 930, 986, 541])

const AREA_CODE_ZONE: Map<number, ZoneKey> = new Map()
for (const [key, codes] of Object.entries(ZONE_AREA_CODES) as [ZoneKey, number[]][]) {
  for (const code of codes) AREA_CODE_ZONE.set(code, key)
}

/** Toll-free prefixes carry no geography at all. */
const TOLL_FREE = new Set([800, 833, 844, 855, 866, 877, 888])

export interface AgencyZone {
  /** IANA zone id. */
  zone: string
  /** 'Eastern', 'Pacific'... */
  name: string
  /** Two-letter state when the address gave us one. */
  state: string | null
  /** True when the state or area code spans two zones and we picked the dominant. */
  approximate: boolean
  /** Which input settled it. */
  source: 'address' | 'phone'
}

/** The COI fields this reads. Loosely typed so callers can pass raw JSONB. */
export interface AgencyLocationInput {
  insurance_company_address?: string | null
  insurance_company_phone?: string | null
}

/** Two-letter USPS state code from a free-form address, or null. */
export function stateFromAddress(address: string | null | undefined): string | null {
  const raw = (address ?? '').trim()
  if (!raw) return null
  // Best signal: the code immediately before a ZIP ("Costa Mesa, CA 92626").
  // Matching that first keeps a street name like "1 OREGON WAY" from winning.
  const byZip = raw.match(/\b([A-Za-z]{2})\.?[\s,]+\d{5}(?:-\d{4})?\b/)
  if (byZip) {
    const code = byZip[1].toUpperCase()
    if (STATE_ZONES[code]) return code
  }
  // Spelled out ("... , Texas 75201" or "... Texas").
  const lower = raw.toLowerCase()
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return code
  }
  // Last resort: the final UPPERCASE two-letter token that is a real state.
  // Case-sensitive on purpose — lowercase "in"/"or"/"me" are English words.
  const tokens = raw.match(/\b[A-Z]{2}\b/g) ?? []
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (STATE_ZONES[tokens[i]]) return tokens[i]
  }
  return null
}

/** North American area code from a free-form phone number, or null. */
export function areaCodeFromPhone(phone: string | null | undefined): number | null {
  let digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length < 10) return null
  const code = Number(digits.slice(0, 3))
  if (!code || TOLL_FREE.has(code)) return null
  return code
}

/** Timezone of the agency that issued the certificate, or null if unplaceable. */
export function agencyTimezone(coi: AgencyLocationInput | null | undefined): AgencyZone | null {
  if (!coi) return null
  const state = stateFromAddress(coi.insurance_company_address)
  const area = areaCodeFromPhone(coi.insurance_company_phone)
  const areaZone = area != null ? AREA_CODE_ZONE.get(area) ?? null : null

  if (state) {
    const stateZone = STATE_ZONES[state]
    // Inside a split state the phone is the more precise instrument (El Paso's
    // 915 is Mountain while the rest of Texas is Central), so it wins there —
    // and only there, since an agency can advertise an out-of-state number.
    if (SPLIT_STATES.has(state) && areaZone) {
      return {
        zone: ZONES[areaZone],
        name: ZONE_NAMES[areaZone],
        state,
        approximate: area != null && SPLIT_AREA_CODES.has(area),
        source: 'phone',
      }
    }
    return {
      zone: ZONES[stateZone],
      name: ZONE_NAMES[stateZone],
      state,
      approximate: SPLIT_STATES.has(state),
      source: 'address',
    }
  }

  if (areaZone) {
    return {
      zone: ZONES[areaZone],
      name: ZONE_NAMES[areaZone],
      state: null,
      approximate: area != null && SPLIT_AREA_CODES.has(area),
      source: 'phone',
    }
  }
  return null
}

/** Where the agency's day is at: drives the queue pill's color. */
export type OfficeState = 'before' | 'open' | 'closing' | 'closed' | 'weekend'

export interface AgencyClock {
  /** '4:42 PM' in the agency's zone. */
  time: string
  /** 'EDT', 'PST', 'MST'... as the zone currently observes it. */
  abbr: string
  /** 0-23 local hour. */
  hour: number
  office: OfficeState
}

/** Assumed agency hours, local: open at 8, last hour of the day starts at 16. */
const OPEN_HOUR = 8
const CLOSING_HOUR = 16
const CLOSE_HOUR = 17

/** Current local time at the agency. */
export function agencyClock(z: AgencyZone, now: Date = new Date()): AgencyClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: z.zone,
    weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  }).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const time = `${get('hour')}:${get('minute')} ${get('dayPeriod')}`.trim()
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: z.zone, hour: 'numeric', hour12: false })
      .format(now)
      .replace(/\D/g, ''),
  ) % 24
  const weekday = get('weekday')
  const office: OfficeState =
    weekday === 'Sat' || weekday === 'Sun' ? 'weekend'
      : hour < OPEN_HOUR ? 'before'
      : hour < CLOSING_HOUR ? 'open'
      : hour < CLOSE_HOUR ? 'closing'
      : 'closed'
  return { time, abbr: get('timeZoneName'), hour, office }
}

/**
 * Queue pill color. Open offices stay in ordinary ink so a full queue is not a
 * wall of green; only "about to close" earns a warning color, because that is
 * the one state that changes what an admin does next.
 */
export function officeColor(office: OfficeState): string {
  if (office === 'closing') return C.warn
  if (office === 'open') return C.txt2
  return C.txt3
}

/** Tooltip: the zone, how we got it, and what the office is doing right now. */
export function agencyClockTitle(z: AgencyZone, clock: AgencyClock): string {
  const where = z.state ? `${z.name} time (${z.state})` : `${z.name} time`
  const how = z.source === 'phone'
    ? 'derived from the agency phone number on the certificate'
    : 'derived from the agency address on the certificate'
  const state = {
    open: 'Office hours now.',
    closing: 'Closing within the hour, call this one first.',
    closed: 'Closed for the day.',
    before: 'Not open yet.',
    weekend: 'Weekend.',
  }[clock.office]
  const caveat = z.approximate ? ' This state spans two zones, so the zone is a best guess.' : ''
  return `${where}, ${clock.time} ${clock.abbr}. ${state}${caveat} (${how}.)`
}
