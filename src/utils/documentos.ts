// Máscaras/validações de documentos usadas em "Dados pessoais" e "Métodos de
// pagamento": CPF, CNPJ, CEP, telefone e data de nascimento. Validação é
// local (dígito verificador), sem chamar nenhum serviço externo — não
// confirma que o documento existe de verdade.

export type TipoCadastro = 'pessoa_fisica' | 'empresa';
export type Sexo = 'masculino' | 'feminino' | 'outro' | 'prefiro_nao_dizer';

export const LABEL_SEXO: Record<Sexo, string> = {
  masculino: 'Masculino',
  feminino: 'Feminino',
  outro: 'Outro',
  prefiro_nao_dizer: 'Prefiro não dizer',
};

export function somenteDigitos(valor: string) {
  return valor.replace(/\D/g, '');
}

export function mascararCPF(valor: string) {
  const digitos = somenteDigitos(valor).slice(0, 11);
  return digitos
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function mascararCNPJ(valor: string) {
  const digitos = somenteDigitos(valor).slice(0, 14);
  return digitos
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function mascararCEP(valor: string) {
  const digitos = somenteDigitos(valor).slice(0, 8);
  return digitos.replace(/(\d{5})(\d{1,3})$/, '$1-$2');
}

export function mascararTelefone(valor: string) {
  const digitos = somenteDigitos(valor).slice(0, 11);
  if (digitos.length <= 10) {
    return digitos.replace(/(\d{2})(\d{4})(\d{1,4})$/, '($1) $2-$3').replace(/(\d{2})(\d{1,4})$/, '($1) $2');
  }
  return digitos.replace(/(\d{2})(\d{5})(\d{1,4})$/, '($1) $2-$3');
}

export function mascararData(valor: string) {
  const digitos = somenteDigitos(valor).slice(0, 8);
  return digitos.replace(/(\d{2})(\d)/, '$1/$2').replace(/(\d{2})(\d{1,4})$/, '$1/$2');
}

// Algoritmo padrão de dígito verificador de CPF (dois módulos 11).
export function validarCPF(valor: string) {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calcularDigito = (tamanhoBase: number) => {
    let soma = 0;
    for (let i = 0; i < tamanhoBase; i++) soma += Number(cpf[i]) * (tamanhoBase + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calcularDigito(9) === Number(cpf[9]) && calcularDigito(10) === Number(cpf[10]);
}

// Algoritmo padrão de dígito verificador de CNPJ.
export function validarCNPJ(valor: string) {
  const cnpj = somenteDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcularDigito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split('').reduce((acc, digito, indice) => acc + Number(digito) * pesos[indice], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const base = cnpj.slice(0, 12);
  const digito1 = calcularDigito(base);
  const digito2 = calcularDigito(base + digito1);
  return cnpj === `${base}${digito1}${digito2}`;
}

export function dataParaISO(dataBR: string): string | null {
  const digitos = somenteDigitos(dataBR);
  if (digitos.length !== 8) return null;
  const dia = digitos.slice(0, 2);
  const mes = digitos.slice(2, 4);
  const ano = digitos.slice(4, 8);
  const data = new Date(`${ano}-${mes}-${dia}T00:00:00`);
  if (data.getUTCDate() !== Number(dia) || data.getUTCMonth() + 1 !== Number(mes)) return null;
  return `${ano}-${mes}-${dia}`;
}

export function isoParaDataBR(dataISO: string | null) {
  if (!dataISO) return '';
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Busca cidade/UF/bairro pelo CEP na API pública do ViaCEP. Retorna null se o
// CEP não tiver 8 dígitos ou não for encontrado.
export async function buscarEnderecoPorCep(cep: string) {
  const digitos = somenteDigitos(cep);
  if (digitos.length !== 8) return null;

  const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
  const dados = await resposta.json();
  if (dados.erro) return null;

  return { cidade: dados.localidade as string, uf: dados.uf as string, bairro: dados.bairro as string };
}

export type TipoChavePix = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

export const LABEL_TIPO_CHAVE_PIX: Record<TipoChavePix, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  telefone: 'Telefone',
  aleatoria: 'Aleatória',
};

export function validarEmail(valor: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim());
}

// Aplica a máscara certa pro tipo de chave (guardada sempre sem máscara no
// banco, exceto e-mail/aleatória que não têm formatação nenhuma).
export function mascararChavePix(tipo: TipoChavePix, valor: string) {
  if (tipo === 'cpf') return mascararCPF(valor);
  if (tipo === 'cnpj') return mascararCNPJ(valor);
  if (tipo === 'telefone') return mascararTelefone(valor);
  return valor;
}
