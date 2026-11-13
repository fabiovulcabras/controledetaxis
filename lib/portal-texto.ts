/** Mensagem de WhatsApp com o portal do fornecedor e os dados de login (e-mail + código de acesso). */
export function textoPortal(f: { nome: string; email?: string | null; codigo_acesso?: string | null }, url: string): string {
  const login = f.email && f.codigo_acesso
    ? `\n\nPara entrar:\nE-mail: ${f.email}\nSenha (código de acesso): *${f.codigo_acesso}*\nBasta entrar uma vez em cada celular ou computador. Se abrir uma corrida pelo link da mensagem e a página pedir, digite o mesmo código. Não compartilhe.`
    : f.codigo_acesso ? `\n\nSeu código de acesso: *${f.codigo_acesso}*. Não compartilhe.` : "";
  return `Olá, ${f.nome}! Este é o seu portal de corridas: ${url}\nPor ele você vê as corridas para responder, as em andamento e as encerradas, e baixa a relação de corridas. Salve nos favoritos.${login}`;
}
