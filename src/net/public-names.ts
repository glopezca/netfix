/**
 * Public names of the emulated Internet: the sites it already had, three Spanish ones asked for in class
 * (google.es, educa.jcyl.es, juandecolonia.es) and the world's most visited domains (Similarweb / Semrush, 2026),
 * leaving out adult and gambling sites (Netfix is used with minors). The addresses are representative of the real
 * ones (large sites answer from many addresses that change); each is a site of the emulated Internet that answers
 * ping and HTTP. The DNS servers of the topology offer the same list as a response policy zone (RPZ).
 */
import type { DnsRecord } from '../services/config.ts';

export interface PublicSite {
  readonly domain: string;
  readonly ip: string;
  /** www.<domain> too (not for names that are already a host, such as gemini.google.com). */
  readonly www: boolean;
}

const RECORD_TTL = 300;

/** [domain, address]; a domain with three or more labels that is a host (news.yahoo.co.jp) gets no www. */
const LIST: readonly (readonly [string, string])[] = [
  // Spain and Castilla y León
  ['google.es', '142.250.200.67'], ['educa.jcyl.es', '217.71.19.5'], ['juandecolonia.es', '217.160.0.201'],
  ['elpais.com', '23.62.227.162'],
  // World top 100 (2026)
  ['youtube.com', '142.250.185.14'], ['facebook.com', '157.240.212.35'], ['instagram.com', '157.240.212.174'],
  ['chatgpt.com', '104.18.32.47'], ['x.com', '104.244.42.1'], ['reddit.com', '151.101.1.140'],
  ['whatsapp.com', '157.240.212.60'], ['bing.com', '13.107.21.200'], ['tiktok.com', '23.38.92.199'],
  ['gemini.google.com', '142.250.184.238'], ['yahoo.co.jp', '182.22.25.252'], ['yahoo.com', '74.6.143.25'],
  ['yandex.ru', '5.255.255.77'], ['amazon.com', '205.251.242.103'], ['linkedin.com', '13.107.42.14'],
  ['baidu.com', '39.156.66.10'], ['naver.com', '223.130.200.104'], ['pinterest.com', '151.101.0.84'],
  ['netflix.com', '54.155.178.5'], ['cloud.microsoft', '13.107.140.6'], ['live.com', '204.79.197.212'],
  ['opera.com', '185.26.182.93'], ['openai.com', '104.18.33.45'], ['bilibili.com', '139.159.241.37'],
  ['temu.com', '23.199.62.85'], ['dzen.ru', '62.217.160.2'], ['weather.com', '23.54.112.33'],
  ['microsoft.com', '20.112.250.133'], ['twitch.tv', '151.101.130.167'], ['vk.com', '87.240.132.78'],
  ['claude.ai', '160.79.104.10'], ['capcut.com', '23.36.163.10'], ['canva.com', '104.16.103.112'],
  ['news.yahoo.co.jp', '182.22.24.124'], ['fandom.com', '151.101.192.194'], ['globo.com', '186.192.81.5'],
  ['mail.ru', '217.69.139.202'], ['samsung.com', '23.52.8.153'], ['duckduckgo.com', '40.114.177.156'],
  ['t.me', '149.154.167.99'], ['wordpress.com', '192.0.78.9'], ['bbc.co.uk', '151.101.0.81'],
  ['discord.com', '162.159.137.232'], ['ebay.com', '66.211.181.181'], ['brave.com', '18.66.192.26'],
  ['booking.com', '104.71.168.191'], ['cnn.com', '151.101.3.5'], ['nytimes.com', '151.101.193.164'],
  ['espn.com', '18.164.96.60'], ['cricbuzz.com', '23.53.40.100'], ['foxnews.com', '23.192.43.5'],
  ['quora.com', '151.101.65.2'], ['spotify.com', '35.186.224.25'], ['roblox.com', '128.116.119.3'],
  ['steampowered.com', '23.205.218.14'], ['walmart.com', '23.36.162.69'], ['aliexpress.com', '47.246.136.218'],
  ['shein.com', '23.72.240.24'], ['taobao.com', '140.205.94.193'], ['jd.com', '111.13.149.108'],
  ['rakuten.co.jp', '23.39.236.33'], ['wildberries.ru', '185.62.202.2'], ['ozon.ru', '185.73.194.82'],
  ['zoom.us', '170.114.52.2'], ['instructure.com', '52.36.92.62'], ['adobe.com', '23.48.180.62'],
  ['salesforce.com', '23.200.143.44'], ['apple.com', '17.253.144.10'], ['office.com', '13.107.6.156'],
  ['paypal.com', '64.4.250.37'], ['imdb.com', '18.165.83.67'], ['indeed.com', '104.18.39.41'],
  ['glassdoor.com', '104.17.19.122'], ['tripadvisor.com', '151.101.2.38'], ['expedia.com', '23.201.205.41'],
  ['agoda.com', '23.220.83.35'], ['perplexity.ai', '104.18.26.48'], ['deepseek.com', '116.205.40.120'],
  ['hotstar.com', '13.32.145.71'], ['espncricinfo.com', '23.32.168.181'], ['theguardian.com', '151.101.129.111'],
  ['washingtonpost.com', '23.199.47.27'], ['reuters.com', '23.10.60.21'], ['forbes.com', '151.101.130.49'],
  ['cnbc.com', '23.6.69.99'], ['medium.com', '162.159.153.4'], ['stackoverflow.com', '104.18.32.7'],
  ['craigslist.org', '208.82.237.226'], ['target.com', '151.101.2.187'], ['homedepot.com', '23.215.0.136'],
  ['costco.com', '23.36.32.38'], ['flipkart.com', '163.53.78.110'], ['myntra.com', '23.55.239.90'],
  ['mercadolibre.com', '23.198.46.214'], ['imgur.com', '151.101.24.193'], ['shutterstock.com', '23.217.104.115'],
];

/** Second-level suffixes under which a domain has three labels (yahoo.co.jp, bbc.co.uk). */
const SECOND_LEVEL = new Set(['co.jp', 'co.uk', 'com.br']);

/** The zone a name belongs to: its registered domain (google.com for gemini.google.com, yahoo.co.jp…). */
export function registeredDomain(name: string): string {
  const labels = name.split('.');
  const keep = SECOND_LEVEL.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export const PUBLIC_SITES: readonly PublicSite[] = LIST.map(([domain, ip]) => ({ domain, ip, www: registeredDomain(domain) === domain || domain.endsWith('.es') }));

const A = (name: string, value: string): DnsRecord => ({ name, type: 'A', value, ttl: RECORD_TTL });

/** A records of the list: each domain and, where it applies, www.domain. */
export function siteRecords(): DnsRecord[] {
  return PUBLIC_SITES.flatMap((s) => [A(s.domain, s.ip), ...(s.www ? [A(`www.${s.domain}`, s.ip)] : [])]);
}
