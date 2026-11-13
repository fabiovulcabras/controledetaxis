import { createCipheriv, createECDH, createPrivateKey, createSign, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

/**
 * Web Push sem bibliotecas: criptografia do conteúdo (RFC 8291, aes128gcm) e identificação do servidor
 * por VAPID (RFC 8292, JWT ES256). Funciona com Chrome, Edge, Firefox e Safari (iOS 16.4+ com o app na tela inicial).
 *
 * Chaves: VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY (base64url) e VAPID_SUBJECT (mailto:… ou https://…).
 * Gere um par em /api/push/gerar-chaves.
 */

export type InscricaoPush = { endpoint: string; p256dh: string; auth: string };
export type ChavesVapid = { publica: string; privada: string; assunto: string };

export const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const deB64url = (t: string) => Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Limpa o valor colado na Vercel: espaços, aspas e quebras de linha. */
const limpar = (v: string | undefined) => String(v ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");

/**
 * "sub" do VAPID precisa ser mailto: ou https:// (a Apple recusa com BadJwtToken).
 * Aceita só o e-mail ("ana@empresa.com") e completa com mailto:.
 */
export function assuntoVapid(v: string | undefined): string {
  const t = limpar(v).replace(/^mailto:/i, "mailto:");
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) || /^https:\/\/[^\s]+$/.test(t)) return t;
  if (/^[^@\s:]+@[^@\s]+\.[^@\s]+$/.test(t)) return `mailto:${t}`;
  return "mailto:planejamento@exemplo.com.br";
}

export function chavesVapid(): ChavesVapid | null {
  const publica = limpar(process.env.VAPID_PUBLIC_KEY), privada = limpar(process.env.VAPID_PRIVATE_KEY);
  if (!publica || !privada) return null;
  return { publica, privada, assunto: assuntoVapid(process.env.VAPID_SUBJECT) };
}

/** A chave pública é mesmo do par da privada? (copiar de dois pares diferentes causa BadJwtToken / 403) */
export function chavesConferem(ch: { publica: string; privada: string }): boolean {
  try {
    const e = createECDH("prime256v1");
    e.setPrivateKey(deB64url(ch.privada));
    return b64url(e.getPublicKey()) === ch.publica;
  } catch { return false; }
}

/** Novo par de chaves VAPID (P-256): pública 65 bytes (não comprimida) e privada 32 bytes, em base64url. */
export function gerarChavesVapid(): { publica: string; privada: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { x: string; y: string; d: string };
  const publica = Buffer.concat([Buffer.from([4]), deB64url(jwk.x), deB64url(jwk.y)]);
  return { publica: b64url(publica), privada: jwk.d };
}

/** Cabeçalho Authorization VAPID para o serviço de push do endpoint (válido por 12 h). */
export function cabecalhoVapid(endpoint: string, chaves: ChavesVapid, agora = Date.now()): string {
  const pub = deB64url(chaves.publica);
  const chave = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: chaves.privada, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }, format: "jwk" });
  const cab = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const carga = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(agora / 1000) + 12 * 3600, sub: chaves.assunto })));
  const assinatura = createSign("SHA256").update(`${cab}.${carga}`).sign({ key: chave, dsaEncoding: "ieee-p1363" });
  return `vapid t=${cab}.${carga}.${b64url(assinatura)}, k=${chaves.publica}`;
}

/** Criptografa a mensagem para a inscrição do navegador (um único registro aes128gcm). */
export function criptografar(inscricao: InscricaoPush, conteudo: Buffer, sal: Buffer = randomBytes(16), chavePrivadaServidor?: Buffer): Buffer {
  const uaPublica = deB64url(inscricao.p256dh);
  const segredo = deB64url(inscricao.auth);
  // Par de chaves efêmero do servidor (um por mensagem); nos testes, pode vir fixo
  const servidor = createECDH("prime256v1");
  if (chavePrivadaServidor) servidor.setPrivateKey(chavePrivadaServidor); else servidor.generateKeys();
  const asPublica = servidor.getPublicKey();
  const compartilhado = servidor.computeSecret(uaPublica);
  const ikm = Buffer.from(hkdfSync("sha256", compartilhado, segredo, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublica, asPublica]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cifra = createCipheriv("aes-128-gcm", cek, nonce);
  const corpo = Buffer.concat([cifra.update(Buffer.concat([conteudo, Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([asPublica.length]), asPublica, corpo]);
}

export type ResultadoPush = { ok: boolean; status: number; expirada: boolean; erro?: string };

/** Envia a notificação. expirada = o navegador cancelou a inscrição (404/410): pode apagar. */
export async function enviarPush(inscricao: InscricaoPush, dados: unknown, chaves: ChavesVapid): Promise<ResultadoPush> {
  try {
    const corpo = criptografar(inscricao, Buffer.from(JSON.stringify(dados)));
    const resp = await fetch(inscricao.endpoint, {
      method: "POST",
      headers: {
        Authorization: cabecalhoVapid(inscricao.endpoint, chaves),
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        TTL: "86400", Urgency: "high",
      },
      body: new Uint8Array(corpo),
      signal: AbortSignal.timeout(8000),
    });
    const expirada = resp.status === 404 || resp.status === 410;
    return { ok: resp.ok, status: resp.status, expirada, erro: resp.ok ? undefined : (await resp.text().catch(() => "")).slice(0, 200) || `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, status: 0, expirada: false, erro: err instanceof Error ? err.message : String(err) };
  }
}
